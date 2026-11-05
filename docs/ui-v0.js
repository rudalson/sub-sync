'use strict'

// The only content in this prototype is the three SRT cues supplied by the user.
// No media, waveform or word-level timings are fabricated.
const cues = [
  { start: 0, end: 5.98, text: "This is how you master the art of conversation, even if you're shy or introverted." },
  { start: 5.98, end: 7.56, text: "I can't talk to girls." },
  { start: 7.56, end: 8.6, text: "I don't know what to say to him." }
]
const originalText = cues.map(cue => cue.text)
const byId = id => document.getElementById(id)
const workspace = byId('workspace')
const divider = byId('divider')
const clips = byId('clips')
const seek = byId('seek')
let undoStack = []
let redoStack = []
let ratio = .58
let pointerDrag = null
let toastTimer

function formatTime(value, hours = true) {
  const total = Math.round(value * 1000)
  const hour = Math.floor(total / 3600000)
  const minute = Math.floor(total / 60000) % 60
  const second = Math.floor(total / 1000) % 60
  const millisecond = total % 1000
  const pair = n => String(n).padStart(2, '0')
  return (hours ? pair(hour) + ':' : '') + pair(minute) + ':' + pair(second) + '.' + String(millisecond).padStart(3, '0')
}

function notify(message) {
  const toast = byId('toast')
  toast.textContent = message
  toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.hidden = true }, 4000)
}

function updateHistoryButtons() {
  byId('undo').disabled = undoStack.length === 0
  byId('redo').disabled = redoStack.length === 0
  const dirty = cues.some((cue, index) => cue.text !== originalText[index])
  byId('project-state').textContent = dirty ? '시안의 문장이 수정되었습니다 · 실제 프로젝트에는 저장되지 않습니다' : '프로젝트를 열면 파일명과 저장 상태를 표시합니다'
}

function renderCards() {
  clips.replaceChildren()
  cues.forEach((cue, index) => {
    const card = document.createElement('article')
    card.className = 'clip'
    const header = document.createElement('header')
    header.className = 'clip-header'
    const number = document.createElement('button')
    number.className = 'clip-number'
    number.textContent = String(index + 1).padStart(2, '0')
    number.setAttribute('aria-label', String(index + 1) + '번 자막으로 이동')
    number.addEventListener('click', () => setTime(cue.start))
    const time = document.createElement('span')
    time.className = 'clip-time'
    const start = document.createElement('span')
    start.textContent = formatTime(cue.start, false)
    const arrow = document.createElement('span')
    arrow.textContent = '→'
    arrow.className = 'time-arrow'
    arrow.setAttribute('aria-hidden', 'true')
    const end = document.createElement('span')
    end.textContent = formatTime(cue.end, false)
    time.append(start, arrow, end)
    const duration = document.createElement('span')
    duration.className = 'clip-duration'
    duration.textContent = (cue.end - cue.start).toFixed(2) + '초'
    header.append(number, time, duration)

    const source = document.createElement('div')
    source.className = 'source-words'
    source.textContent = originalText[index]
    const wave = document.createElement('div')
    wave.className = 'wave-placeholder'
    wave.textContent = '[단어별 타임스탬프 · 파형]'

    const text = document.createElement('textarea')
    text.className = 'clip-text'
    text.value = cue.text
    text.rows = 1
    text.spellcheck = false
    text.setAttribute('aria-label', String(index + 1) + '번 자막 문장')
    let editStarted = false
    text.addEventListener('focus', () => { editStarted = false })
    text.addEventListener('input', () => {
      if (!editStarted) {
        undoStack.push(cues.map(item => item.text))
        redoStack = []
        editStarted = true
      }
      cue.text = text.value
      count.textContent = String(cue.text.length) + '자'
      updateHistoryButtons()
      setTime(Number(seek.value), false)
    })

    const footer = document.createElement('footer')
    footer.className = 'clip-footer'
    const count = document.createElement('span')
    count.className = 'char-count'
    count.textContent = String(cue.text.length) + '자'
    const actions = document.createElement('div')
    actions.className = 'clip-actions'
    if (index < cues.length - 1) {
      const merge = document.createElement('button')
      merge.className = 'quiet'
      merge.textContent = '다음과 합치기'
      merge.addEventListener('click', () => notify('합치기 버튼의 배치 시안입니다. 실제 자막 편집은 앱에 연결됩니다.'))
      actions.append(merge)
    }
    const remove = document.createElement('button')
    remove.className = 'quiet'
    remove.textContent = '삭제'
    remove.addEventListener('click', () => notify('삭제 버튼의 배치 시안입니다. 샘플 문장은 유지됩니다.'))
    actions.append(remove)
    footer.append(count, actions)
    card.append(header, source, wave, text, footer)
    clips.append(card)
  })
  setTime(Number(seek.value), false)
  updateHistoryButtons()
}

function setTime(value, follow = true) {
  const next = Math.max(0, Math.min(8.6, value))
  seek.value = String(next)
  seek.setAttribute('aria-valuetext', next.toFixed(2) + '초')
  byId('timecode').textContent = formatTime(next)
  byId('current-clock').textContent = formatTime(next, false)
  const active = cues.findIndex((cue, index) => next >= cue.start && (next < cue.end || index === cues.length - 1 && next === cue.end))
  byId('caption').textContent = cues[active]?.text || ''
  Array.from(clips.children).forEach((card, index) => {
    const selected = index === active
    card.classList.toggle('active', selected)
    if (!selected || !follow || !byId('follow').checked) return
    const scroller = byId('subtitle-scroll')
    if (card.offsetTop < scroller.scrollTop || card.offsetTop + card.offsetHeight > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = card.offsetTop - 12
    }
  })
}

function setRatio(value) {
  const available = Math.max(1, workspace.clientWidth - 10)
  const min = Math.max(.3, 360 / available)
  const max = Math.min(.75, 1 - 400 / available)
  ratio = Math.max(min, Math.min(max, value))
  workspace.style.gridTemplateColumns = 'minmax(0,' + ratio + 'fr) 10px minmax(0,' + (1 - ratio) + 'fr)'
  divider.setAttribute('aria-valuemin', String(Math.round(min * 100)))
  divider.setAttribute('aria-valuemax', String(Math.round(max * 100)))
  divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)))
  divider.setAttribute('aria-valuetext', '영상 ' + Math.round(ratio * 100) + '%, 자막 ' + Math.round((1 - ratio) * 100) + '%')
}

divider.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary || pointerDrag) return
  event.preventDefault()
  divider.focus()
  pointerDrag = { pointerId: event.pointerId, original: ratio, offset: event.clientX - divider.getBoundingClientRect().left }
  divider.setPointerCapture(event.pointerId)
  workspace.classList.add('resizing')
})
divider.addEventListener('pointermove', event => {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return
  setRatio((event.clientX - workspace.getBoundingClientRect().left - pointerDrag.offset) / (workspace.clientWidth - 10))
})
function finishDrag(cancel = false) {
  if (!pointerDrag) return
  const active = pointerDrag
  pointerDrag = null
  if (cancel) setRatio(active.original)
  workspace.classList.remove('resizing')
  if (divider.hasPointerCapture(active.pointerId)) divider.releasePointerCapture(active.pointerId)
}
divider.addEventListener('pointerup', () => finishDrag())
divider.addEventListener('pointercancel', () => finishDrag(true))
divider.addEventListener('lostpointercapture', () => finishDrag(true))
divider.addEventListener('dblclick', () => setRatio(.58))
divider.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') setRatio(ratio - (event.shiftKey ? .1 : .02))
  else if (event.key === 'ArrowRight') setRatio(ratio + (event.shiftKey ? .1 : .02))
  else if (event.key === 'Home') setRatio(0)
  else if (event.key === 'End') setRatio(1)
  else if (event.key === 'Enter') setRatio(.58)
  else if (event.key === 'Escape' && pointerDrag) finishDrag(true)
  else return
  event.preventDefault()
  event.stopPropagation()
})
new ResizeObserver(() => setRatio(ratio)).observe(workspace)

seek.addEventListener('input', () => setTime(Number(seek.value)))
byId('back').addEventListener('click', () => setTime(Number(seek.value) - 1))
byId('forward').addEventListener('click', () => setTime(Number(seek.value) + 1))
byId('rate').addEventListener('change', () => notify('재생 속도 선택의 시안입니다. 실제 영상 연결 후 적용됩니다.'))
byId('follow').addEventListener('change', () => setTime(Number(seek.value)))

function restoreSnapshot(stack, opposite) {
  if (stack.length === 0) return
  opposite.push(cues.map(cue => cue.text))
  const previous = stack.pop()
  cues.forEach((cue, index) => { cue.text = previous[index] })
  renderCards()
}
byId('undo').addEventListener('click', () => restoreSnapshot(undoStack, redoStack))
byId('redo').addEventListener('click', () => restoreSnapshot(redoStack, undoStack))

document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('details[open]').forEach(menu => { menu.open = false })
  button.closest('dialog')?.close()
  notify(button.dataset.preview + ': 화면 구성 시안입니다. 실제 앱 기능은 다음 단계에서 연결합니다.')
}))
document.addEventListener('pointerdown', event => {
  document.querySelectorAll('details[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false })
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    document.querySelectorAll('details[open]').forEach(menu => { menu.open = false })
    if (!byId('tweaks').hidden) showTweaks(false)
  }
})

for (const [button, dialog] of [['assumptions-open', 'assumptions-dialog'], ['stt-open', 'stt-dialog'], ['export-open', 'export-dialog']]) {
  byId(button).addEventListener('click', () => byId(dialog).showModal())
}
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()))
document.querySelectorAll('.preset-row button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.preset-row button').forEach(preset => {
    preset.classList.toggle('selected', preset === button)
    preset.setAttribute('aria-pressed', String(preset === button))
  })
}))

function showTweaks(visible) {
  byId('tweaks').hidden = !visible
  byId('tweaks-toggle').setAttribute('aria-expanded', String(visible))
  if (visible) byId('variant').focus()
  else byId('tweaks-toggle').focus()
}
byId('tweaks-toggle').addEventListener('click', () => showTweaks(byId('tweaks').hidden))
byId('tweaks-close').addEventListener('click', () => showTweaks(false))
byId('variant').addEventListener('change', event => {
  document.body.dataset.variant = event.target.value
  setRatio(event.target.value === 'reading' ? .52 : .58)
})
byId('density').addEventListener('change', event => { document.body.dataset.density = event.target.value })
byId('preview-state').addEventListener('change', event => {
  document.body.dataset.state = event.target.value
  const empty = event.target.value === 'empty'
  document.querySelectorAll('.transport input, .transport button, .transport select').forEach(control => { control.disabled = empty || control.classList.contains('play-button') })
})
byId('caption-box').addEventListener('change', event => { document.querySelector('.caption').classList.toggle('no-box', !event.target.checked) })
byId('reset-preview').addEventListener('click', () => {
  document.body.dataset.variant = 'balanced'
  document.body.dataset.density = 'normal'
  document.body.dataset.state = 'sample'
  byId('variant').value = 'balanced'
  byId('density').value = 'normal'
  byId('preview-state').value = 'sample'
  byId('caption-box').checked = true
  byId('follow').checked = true
  document.querySelector('.caption').classList.remove('no-box')
  document.querySelectorAll('.transport input, .transport button, .transport select').forEach(control => { control.disabled = control.classList.contains('play-button') })
  cues.forEach((cue, index) => { cue.text = originalText[index] })
  undoStack = []
  redoStack = []
  seek.value = '0'
  byId('rate').value = '1×'
  renderCards()
  setRatio(.58)
})

renderCards()
setRatio(ratio)
