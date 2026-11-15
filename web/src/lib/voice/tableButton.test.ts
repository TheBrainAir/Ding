import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BluetoothButton,
  DEVICE_NAME_PREFIX,
  NUS_RX,
  NUS_SERVICE,
  NUS_TX,
  WRITE_CHUNK,
  type BtApi,
  type BtCharacteristic,
  type BtDevice,
  type BtServer,
  type BtService,
} from './bluetoothButton'
import { lcdText, marqueePassMs, type ButtonLinkStatus } from './buttonLink'
import { SerialButton } from './serialButton'

const enc = new TextEncoder()
const dec = new TextDecoder()

// ---------------------------------------------------------------- fake Web Bluetooth

class FakeCharacteristic extends EventTarget implements BtCharacteristic {
  value: DataView | null = null
  properties = { write: true, writeWithoutResponse: true }
  writes: string[] = []
  notifying = false

  async startNotifications() {
    this.notifying = true
    return this
  }

  async writeValueWithResponse(value: Uint8Array) {
    if (value.byteLength > WRITE_CHUNK) throw new Error('write longer than one ATT payload')
    this.writes.push(dec.decode(value))
  }

  /** The board sends `text` in one notification. */
  notify(text: string) {
    const bytes = enc.encode(text)
    this.value = new DataView(bytes.buffer)
    this.dispatchEvent(new Event('characteristicvaluechanged'))
  }
}

class FakeDevice extends EventTarget implements BtDevice {
  readonly id = 'dev-1'
  readonly name = 'Ding-A1B2'
  rx = new FakeCharacteristic()
  tx = new FakeCharacteristic()
  /** Number of upcoming connect() calls that fail (out of range). */
  failConnects = 0
  connects = 0
  gatt: BtServer

  constructor() {
    super()
    const service: BtService = {
      getCharacteristic: async (uuid: string) => {
        if (uuid === NUS_RX) return this.rx
        if (uuid === NUS_TX) return this.tx
        throw new Error(`no characteristic ${uuid}`)
      },
    }
    const server = {
      connected: false,
      connect: async () => {
        this.connects++
        if (this.failConnects > 0) {
          this.failConnects--
          throw new DOMException('Bluetooth Device is no longer in range.', 'NetworkError')
        }
        server.connected = true
        return server
      },
      disconnect: () => {
        server.connected = false
      },
      getPrimaryService: async (uuid: string) => {
        if (uuid !== NUS_SERVICE) throw new Error('wrong service')
        return service
      },
    }
    this.gatt = server
  }

  /** The link drops (board reset, out of range). */
  drop() {
    ;(this.gatt as { connected: boolean }).connected = false
    this.dispatchEvent(new Event('gattserverdisconnected'))
  }

  /** Everything written so far, as one string. */
  get written() {
    return this.rx.writes.join('')
  }
}

function fakeBluetooth(device: FakeDevice, { getDevices = true } = {}) {
  const requestDevice = vi.fn(async () => device)
  const api: BtApi = { requestDevice }
  if (getDevices) api.getDevices = async () => [device]
  return { api, requestDevice }
}

function makeButton(api: BtApi | null, backoffMs = [100, 200, 400]) {
  const events: string[] = []
  const statuses: ButtonLinkStatus[] = []
  const button = new BluetoothButton(
    {
      onPress: () => events.push('press'),
      onRelease: () => events.push('release'),
      onStatus: (s) => statuses.push(s),
    },
    { bluetooth: api, backoffMs },
  )
  return { button, events, statuses }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

describe('BluetoothButton', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens a chooser filtered to the Nordic UART service or the Ding name prefix', async () => {
    const device = new FakeDevice()
    const { api, requestDevice } = fakeBluetooth(device)
    const { button, statuses } = makeButton(api)
    await button.connect()
    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [NUS_SERVICE] }, { namePrefix: DEVICE_NAME_PREFIX }],
      optionalServices: [NUS_SERVICE],
    })
    expect(statuses).toEqual(['connecting', 'connected'])
    expect(device.tx.notifying).toBe(true)
    await flush()
    expect(device.written).toBe('STATE:idle\n') // no INFO until the page sets one
  })

  it('reassembles lines split across notifications', async () => {
    const device = new FakeDevice()
    const { button, events } = makeButton(fakeBluetooth(device).api)
    await button.connect()
    device.tx.notify('PRE')
    device.tx.notify('SS\r\nREL')
    device.tx.notify('EASE\nPRESS\nnoise\n')
    expect(events).toEqual(['press', 'release', 'press'])
  })

  it('sends only changes, and everything again after READY', async () => {
    const device = new FakeDevice()
    const { button } = makeButton(fakeBluetooth(device).api)
    await button.connect()
    await button.sendState('listening')
    await button.sendState('listening')
    await button.sendInfo('Table 4')
    await button.sendInfo('Table 4')
    expect(device.written).toBe('STATE:idle\nSTATE:listening\nINFO:Table 4\n')

    device.rx.writes = []
    device.tx.notify('READY\n') // the board rebooted
    await flush()
    expect(device.written).toBe('STATE:listening\nINFO:Table 4\n')
  })

  it('chunks long lines to one ATT payload each', async () => {
    const device = new FakeDevice()
    const { button } = makeButton(fakeBluetooth(device).api)
    await button.connect()
    device.rx.writes = []
    await button.sendInfo('1x Lemongrass Ginger Lemonade')
    expect(device.rx.writes.every((w) => w.length <= WRITE_CHUNK)).toBe(true)
    expect(device.rx.writes.length).toBe(2) // 35 bytes: 20 + 15
    expect(device.written).toBe('INFO:1x Lemongrass Ginger Lemonade\n')
  })

  it('keeps INFO to 60 characters (the board scrolls anything over 16)', async () => {
    const device = new FakeDevice()
    const { button } = makeButton(fakeBluetooth(device).api)
    await button.connect()
    device.rx.writes = []
    await button.sendInfo('x'.repeat(80))
    expect(device.written).toBe(`INFO:${'x'.repeat(60)}\n`)
  })

  it('reconnects with backoff after the link drops, without a new click', async () => {
    const device = new FakeDevice()
    const { api, requestDevice } = fakeBluetooth(device)
    const { button, statuses } = makeButton(api, [100, 200, 400])
    await button.connect()
    await button.sendState('speaking')
    await button.sendInfo('Order sent')

    device.failConnects = 1 // first retry: still out of range
    device.rx.writes = []
    device.drop()
    expect(button.status).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(100)
    expect(device.connects).toBe(2)
    expect(button.status).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(200)
    expect(device.connects).toBe(3)
    expect(button.status).toBe('connected')
    expect(requestDevice).toHaveBeenCalledTimes(1)
    await flush()
    expect(device.written).toBe('STATE:speaking\nINFO:Order sent\n') // the board got its screen back
    expect(statuses).toEqual(['connecting', 'connected', 'reconnecting', 'connected'])
  })

  it('stays disconnected after the user disconnects', async () => {
    const device = new FakeDevice()
    const { button } = makeButton(fakeBluetooth(device).api)
    await button.connect()
    await button.disconnect()
    device.drop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(button.status).toBe('disconnected')
    expect(device.connects).toBe(1)
  })

  it('reopens a granted device on reload without a prompt, or keeps trying in the background', async () => {
    const device = new FakeDevice()
    const { api, requestDevice } = fakeBluetooth(device)
    device.failConnects = 1
    const { button } = makeButton(api, [100])
    expect(await button.reconnectKnown()).toBe(true)
    expect(button.status).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(100)
    expect(button.status).toBe('connected')
    expect(requestDevice).not.toHaveBeenCalled()
  })

  it('degrades gracefully without getDevices() or without Web Bluetooth', async () => {
    const device = new FakeDevice()
    const { button } = makeButton(fakeBluetooth(device, { getDevices: false }).api)
    expect(await button.reconnectKnown()).toBe(false)
    expect(button.status).toBe('disconnected')

    expect(BluetoothButton.isSupported(null)).toBe(false)
    const none = makeButton(null)
    await expect(none.button.connect()).rejects.toThrow(/Web Bluetooth/)
  })

  it('reports a failed first connect instead of retrying silently', async () => {
    const device = new FakeDevice()
    device.failConnects = 5
    const { button } = makeButton(fakeBluetooth(device).api)
    await expect(button.connect()).rejects.toThrow(/no longer in range/)
    expect(button.status).toBe('disconnected')
    await vi.advanceTimersByTimeAsync(5000)
    expect(device.connects).toBe(1)
  })
})

// ---------------------------------------------------------------- USB (Web Serial), unchanged protocol

function fakeSerialPort() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const writes: string[] = []
  const port = {
    readable: new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) }),
    writable: new WritableStream<Uint8Array>({ write: (chunk) => void writes.push(dec.decode(chunk)) }),
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
  return { port, writes, send: (text: string) => controller.enqueue(enc.encode(text)), unplug: () => controller.error(new Error('lost')) }
}

describe('SerialButton', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('speaks the same protocol: STATE, INFO, PRESS/RELEASE, READY resync, unplug', async () => {
    const fake = fakeSerialPort()
    vi.stubGlobal('navigator', { serial: { requestPort: async () => fake.port, getPorts: async () => [fake.port] } })
    const events: string[] = []
    const statuses: ButtonLinkStatus[] = []
    const button = new SerialButton({
      onPress: () => events.push('press'),
      onRelease: () => events.push('release'),
      onStatus: (s) => statuses.push(s),
    })
    await button.connect()
    expect(fake.port.open).toHaveBeenCalledWith({ baudRate: 115_200 })
    await button.sendState('thinking')
    await button.sendInfo('Table 1')
    expect(fake.writes.join('')).toBe('STATE:idle\nSTATE:thinking\nINFO:Table 1\n')

    // The legacy Uno sketch sends READY after its auto-reset and ignores INFO lines.
    fake.writes.length = 0
    fake.send('READY\r\nPRESS\r\n')
    fake.send('RELEASE\r\n')
    await vi.waitFor(() => expect(events).toEqual(['press', 'release']))
    await vi.waitFor(() => expect(fake.writes.join('')).toBe('STATE:thinking\nINFO:Table 1\n'))

    fake.unplug()
    await vi.waitFor(() => expect(button.status).toBe('disconnected'))
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected'])
  })
})

// ---------------------------------------------------------------- LCD text

describe('marqueePassMs', () => {
  it('is zero for text that fits and one full scroll otherwise', () => {
    expect(marqueePassMs('Table 4')).toBe(0)
    expect(marqueePassMs('x'.repeat(16))).toBe(0)
    expect(marqueePassMs('x'.repeat(17))).toBe(1200 + 280 + 1200)
    expect(marqueePassMs('x'.repeat(100))).toBe(1200 + 44 * 280 + 1200) // capped at 60 characters
  })
})

describe('lcdText', () => {
  it('keeps plain ASCII and cuts to 16 characters', () => {
    expect(lcdText('Table 4')).toBe('Table 4')
    expect(lcdText('A very long table name indeed')).toBe('A very long tabl')
    expect(lcdText('  two   spaces\tand\nlines ')).toBe('two spaces and l')
  })

  it('strips accents and turns other scripts into one ? per character', () => {
    expect(lcdText('Café crème brûlée')).toBe('Cafe creme brule')
    expect(lcdText('Стол 4')).toBe('???? 4')
    expect(lcdText('Սեղան 2')).toBe('????? 2')
    expect(lcdText('Pizza 🍕!')).toBe('Pizza ?!')
    expect(lcdText('€12')).toBe('?12')
  })
})
