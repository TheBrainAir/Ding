"""`ding-bridge --table <token>`: the headless guest side of a Ding table.

Runs on the laptop next to the table-button box: reads the button over USB serial, records
the guest from the microphone, streams the turn to the backend and plays the reply.
"""

import argparse
import asyncio
import contextlib
import signal
import sys
import threading

from ding_bridge import audio
from ding_bridge.app import HELP, Bridge
from ding_bridge.backend import Backend, BackendError, UnknownTable
from ding_bridge.console import Console
from ding_bridge.serial_link import SerialLink, candidate_ports

EXIT_BACKEND = 2
EXIT_VOICE = 3
EXIT_AUDIO = 4
EXIT_SERIAL = 5


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="ding-bridge",
        description="Connect a Ding table button (USB serial), a microphone and a speaker to the Ding backend.",
    )
    p.add_argument("--table", metavar="TOKEN", help="table token (Dashboard > Tables shows the full command)")
    p.add_argument("--server", default="http://localhost:8010", help="backend URL (default: %(default)s)")
    p.add_argument("--port", help="serial port of the button box (default: auto-detect)")
    p.add_argument("--keyboard", action="store_true", help="no button box: Enter starts / sends a recording")
    p.add_argument("--input-device", help="microphone: index or part of the name (see --list-devices)")
    p.add_argument("--output-device", help="speaker: index or part of the name (see --list-devices)")
    p.add_argument("--list-devices", action="store_true", help="list audio devices and exit")
    p.add_argument("--list-ports", action="store_true", help="list serial ports that look like a button box and exit")
    p.add_argument("--tap-ms", type=int, default=300, help="presses shorter than this are taps (default: %(default)s)")
    p.add_argument("--max-seconds", type=float, default=30, help="longest recording (default: %(default)s)")
    p.add_argument("-v", "--verbose", action="store_true", help="show more detail")
    return p.parse_args(argv)


async def startup_checks(args: argparse.Namespace, console: Console):
    """Check everything up front and report every problem at once.

    Returns (exit_code, backend, player, input_device, port)."""
    code = 0

    def fail(c: int, message: str) -> None:
        nonlocal code
        console.fail(message)
        code = code or c

    backend = Backend(args.server, args.table)
    table = None
    try:
        health = await backend.health()
        console.ok(f"backend {args.server} ({health.get('app', '?')})")
        try:
            table = await backend.table()
            console.ok(f"table '{table['table_label']}' at {table['restaurant_name']}, waiter {table['persona_name']}")
        except UnknownTable:
            fail(EXIT_BACKEND, f"unknown table token '{args.table}'. Copy the command from Dashboard > Tables.")
        if table is not None:
            if table.get("voice_enabled"):
                console.ok("voice is on (speech recognition and speech are configured on the server)")
            else:
                fail(
                    EXIT_VOICE,
                    "voice is off on the server: backend/.env has no ELEVENLABS_API_KEY. "
                    "Add it and restart the backend.",
                )
    except BackendError as e:
        fail(EXIT_BACKEND, f"{e}. Start it with ./dev.sh (or ./dev.sh backend), or pass --server URL.")

    player, input_device = None, None
    try:
        output_device = audio.resolve_device(args.output_device, "output")
        player = audio.Player(output_device)
        player.open()
        console.ok(f"speaker: {audio.device_name(output_device, 'output')} ({player.sample_rate} Hz)")
    except audio.AudioError as e:
        fail(EXIT_AUDIO, f"speaker: {e}")
        player = None
    try:
        input_device = audio.resolve_device(args.input_device, "input")
        mic_name = audio.device_name(input_device, "input")
    except audio.AudioError as e:
        fail(EXIT_AUDIO, f"microphone: {e}")
        mic_name = None

    port = None
    if args.keyboard:
        console.ok("keyboard mode: press Enter to start and send a recording")
    else:
        ports = candidate_ports()
        port = args.port or (ports[0] if ports else None)
        if port is None:
            fail(
                EXIT_SERIAL,
                "no table button found on USB serial. Plug in the box, pass --port PATH (see --list-ports), "
                "or run with --keyboard to test with the Enter key.",
            )
        elif args.port and args.port not in ports:
            console.warn(f"--port {args.port} does not look like a button box; trying it anyway")
        if port is not None:
            console.ok(f"table button on {port}")

    # The microphone is opened last and only when everything else is fine, so a broken
    # setup never pops up the OS microphone-permission dialog for nothing.
    if mic_name is not None:
        if code:
            console.info(f"microphone: {mic_name} (not tested until the problems above are fixed)")
        else:
            problem = audio.probe_microphone(input_device)
            if problem:
                fail(EXIT_AUDIO, f"microphone {mic_name}: {problem}")
            else:
                console.ok(f"microphone: {mic_name}")

    if code:
        if player is not None:
            player.close()
        await backend.aclose()
        return code, None, None, None, None
    return 0, backend, player, input_device, port


def _read_stdin(bridge: Bridge, keyboard: bool) -> None:
    commands = {
        "": "toggle",
        "r": "reset",
        "reset": "reset",
        "new": "reset",
        "s": "status",
        "status": "status",
        "q": "quit",
        "quit": "quit",
        "exit": "quit",
        "h": "help",
        "help": "help",
        "?": "help",
    }
    for line in sys.stdin:
        kind = commands.get(line.strip().lower())
        if kind:
            bridge.post(kind)
        else:
            bridge.post("help")
    if keyboard:  # stdin closed: nothing can drive the bridge any more
        bridge.post("quit")


async def run(args: argparse.Namespace) -> int:
    console = Console(verbose=args.verbose)
    console.info(f"Ding bridge for table {args.table}")
    # The link auto-detects on its own (a re-plugged board can come back under a new name).
    code, backend, player, input_device, _port = await startup_checks(args, console)
    if code:
        console.error("cannot start, see FAIL above")
        return code

    bridge = Bridge(
        backend,
        player,
        audio.Recorder(input_device),
        console=console,
        tap_ms=args.tap_ms,
        max_seconds=args.max_seconds,
    )
    link = None
    if not args.keyboard:
        link = SerialLink(bridge.on_serial_line, bridge.on_serial_status, port=args.port)
        bridge.link = link

    loop = asyncio.get_running_loop()
    with contextlib.suppress(NotImplementedError):
        loop.add_signal_handler(signal.SIGINT, bridge.post, "quit")
        loop.add_signal_handler(signal.SIGTERM, bridge.post, "quit")
    runner = asyncio.create_task(bridge.run())
    await asyncio.sleep(0)  # let run() set up its queue before threads post into it
    threading.Thread(target=_read_stdin, args=(bridge, args.keyboard), name="stdin", daemon=True).start()
    if link is not None:
        link.start()
    console.info(HELP)
    bridge.earcon("ready")
    try:
        await runner
    finally:
        await bridge.shutdown()
        if link is not None:
            link.stop()
        player.close()
        await backend.aclose()
        console.info("bye")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.list_devices:
        try:
            print(audio.list_devices())
        except Exception as e:
            print(f"cannot list audio devices: {e}", file=sys.stderr)
            return EXIT_AUDIO
        return 0
    if args.list_ports:
        ports = candidate_ports()
        print("\n".join(ports) if ports else "no serial port that looks like a table button")
        return 0
    if not args.table:
        print("ding-bridge: --table TOKEN is required (Dashboard > Tables shows the full command)", file=sys.stderr)
        return 1
    try:
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
