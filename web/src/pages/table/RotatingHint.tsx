import { useEffect, useState } from 'react'

/** "Press the button and speak in your language", in the languages guests are likely to walk in with. */
const HINTS: { lang: string; text: string; dir?: 'rtl' }[] = [
  { lang: 'en', text: 'Press the button and speak in your language' },
  { lang: 'es', text: 'Pulsa el botón y habla en tu idioma' },
  { lang: 'fr', text: 'Appuyez sur le bouton et parlez dans votre langue' },
  { lang: 'de', text: 'Drück den Knopf und sprich in deiner Sprache' },
  { lang: 'it', text: 'Premi il pulsante e parla nella tua lingua' },
  { lang: 'ja', text: 'ボタンを押して、あなたの言葉で話してください' },
  { lang: 'hy', text: 'Սեղմեք կոճակը և խոսեք ձեր լեզվով' },
  { lang: 'zh', text: '按下按钮，用你的语言说话' },
  { lang: 'ar', text: 'اضغط على الزر وتحدث بلغتك', dir: 'rtl' },
  { lang: 'ru', text: 'Нажмите кнопку и говорите на своём языке' },
  { lang: 'ko', text: '버튼을 누르고 편한 언어로 말해 보세요' },
  { lang: 'pt', text: 'Aperte o botão e fale no seu idioma' },
  { lang: 'hi', text: 'बटन दबाएँ और अपनी भाषा में बोलें' },
  { lang: 'tr', text: 'Düğmeye bas ve kendi dilinde konuş' },
]

export function RotatingHint({ intervalMs = 3200 }: { intervalMs?: number }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % HINTS.length), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  const hint = HINTS[index]
  return (
    <p className="relative min-h-[2.6em] text-center font-display text-[clamp(1.25rem,2.6vw,1.9rem)] leading-tight font-medium text-linen">
      <span key={index} aria-hidden lang={hint.lang} dir={hint.dir} className="block animate-in fade-in-0 slide-in-from-bottom-1 duration-500">
        {hint.text}
      </span>
      <span className="sr-only">Press the button and speak in your language.</span>
    </p>
  )
}
