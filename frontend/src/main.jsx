import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RefreshCw } from 'lucide-react'
import './styles.css'

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '')
const PROFILE_KEY = 'jobpilot.profile'
const LIKED_KEY = 'jobpilot.liked'
const SEEN_KEY = 'jobpilot.seen'
const HISTORY_KEY = 'jobpilot.history'
const advancedDefaults = { physical: 'Неважно', risk: 'Неважно', stress: 'Неважно', travel: 'Неважно', schedule: 'Неважно', nights: 'Неважно', communication: 'Неважно', employment: 'Неважно', education: 'Неважно', experience: 'Неважно' }
const initialProfile = { profession: '', skills: '', salary: '', city: '', format: 'any', apiEnabled: true, advanced: advancedDefaults }
const advancedFilters = [['physical', 'Физическая нагрузка', ['Неважно', 'Низкая', 'Средняя', 'Высокая']], ['risk', 'Риск', ['Неважно', 'Низкий', 'Средний', 'Высокий']], ['stress', 'Стресс', ['Неважно', 'Низкий', 'Средний', 'Высокий']], ['travel', 'Командировки', ['Неважно', 'Не готов(а)', 'Редко', 'Готов(а)']], ['schedule', 'График', ['Неважно', 'Полный день', 'Гибкий']], ['nights', 'Ночные смены', ['Неважно', 'Нет', 'Допустимы']], ['communication', 'Общение', ['Неважно', 'Минимум', 'Командная работа']], ['employment', 'Тип занятости', ['Неважно', 'Полная', 'Частичная', 'Проектная']], ['education', 'Образование', ['Неважно', 'Среднее', 'Высшее']], ['experience', 'Опыт', ['Неважно', 'Без опыта', '1–3 года', '3+ года']]]

function stored(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback } }
function Icon({ name }) { const d = { feed: 'M4 6h16M4 12h16M4 18h11', heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.9-8.6a5.5 5.5 0 0 0-.1-7.8Z', send: 'm22 2-7 20-4-9-9-4Z', user: 'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', x: 'M18 6 6 18M6 6l12 12', refresh: 'M20 4v7h-7M4 13a8 8 0 1 0 2-5', history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2', bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4' }; return <svg viewBox="0 0 24 24"><path d={d[name]} /></svg> }
function salary(item) { if (item.salary_from && item.salary_to) return `${item.salary_from.toLocaleString('ru-RU')}–${item.salary_to.toLocaleString('ru-RU')} ${item.currency || ''}`; if (item.salary_from) return `от ${item.salary_from.toLocaleString('ru-RU')} ${item.currency || ''}`; if (item.salary_to) return `до ${item.salary_to.toLocaleString('ru-RU')} ${item.currency || ''}`; return 'Зарплата не указана' }
function Empty({ icon, title, text }) { return <div className="empty"><div><Icon name={icon}/></div><h2>{title}</h2><p>{text}</p></div> }

function App() {
  const [tab, setTab] = useState('feed'), [profile, setProfile] = useState(() => { const saved = stored(PROFILE_KEY, initialProfile); return {...initialProfile, ...saved, format: saved.format === 'Любой' ? 'any' : saved.format || 'any', advanced: {...advancedDefaults, ...(saved.advanced || {})}} }), [liked, setLiked] = useState(() => stored(LIKED_KEY, [])), [seen, setSeen] = useState(() => stored(SEEN_KEY, [])), [history, setHistory] = useState(() => stored(HISTORY_KEY, [])), [selected, setSelected] = useState([])
  const [jobs, setJobs] = useState([]), [index, setIndex] = useState(0), [status, setStatus] = useState('idle'), [error, setError] = useState(''), [sourceErrors, setSourceErrors] = useState([]), [stats, setStats] = useState({source: 0, matched: 0, alreadyViewed: 0}), [profileSaved, setProfileSaved] = useState(false)
  const pointer = useRef(null); const decisionLocked = useRef(false); const exitTimer = useRef(null); const requestSequence = useRef(0); const requestController = useRef(null); const reloadAfterClear = useRef(false)
  const [outgoing, setOutgoing] = useState(null), [motion, setMotion] = useState({x: 0, y: 0, dragging: false, exiting: false})
  const likedIds = useMemo(() => new Set(liked.map((job) => job.id)), [liked]); const seenIds = useMemo(() => new Set(seen), [seen]); const current = jobs[index]
  useEffect(() => localStorage.setItem(LIKED_KEY, JSON.stringify(liked)), [liked]); useEffect(() => localStorage.setItem(SEEN_KEY, JSON.stringify(seen)), [seen]); useEffect(() => localStorage.setItem(HISTORY_KEY, JSON.stringify(history)), [history])
  useEffect(() => () => clearTimeout(exitTimer.current), [])
  useEffect(() => { if (!outgoing) decisionLocked.current = false }, [index, outgoing])
  useEffect(() => { if (tab !== 'feed' && pointer.current) { pointer.current = null; setMotion({x: 0, y: 0, dragging: false, exiting: false}) } }, [tab])
  async function load() { if (requestController.current) return; const controller = new AbortController(); requestController.current = controller; const requestId = ++requestSequence.current; setError(''); setSourceErrors([]); setStats({source: 0, matched: 0, alreadyViewed: 0}); setIndex(0); if (!profile.apiEnabled) { setJobs([]); setStatus('disabled'); requestController.current = null; return } setStatus('loading'); const salaryMin = Number(profile.salary.replace(/\D/g, '')); const params = { profession: profile.profession, skills: profile.skills, city: profile.city, work_format: profile.format, page: '0', per_page: '20' }; if (salaryMin) params.salary_min = String(salaryMin); try { const r = await fetch(`${API_URL}/api/vacancies?${new URLSearchParams(params)}`, {signal: controller.signal}); const data = await r.json().catch(() => ({})); if (requestId !== requestSequence.current) return; if (!r.ok) { setSourceErrors(data.detail?.source_errors || []); throw Error(typeof data.detail === 'string' ? data.detail : `Ошибка API: ${r.status}`) } const errors = data.source_errors || []; setSourceErrors(errors); if (errors.length) { setJobs([]); setStatus('source-error'); return } const matches = data.items || []; const viewed = matches.filter((job) => likedIds.has(job.id) || seenIds.has(job.id)); setStats({source: data.source_total ?? matches.length, matched: data.matched_total ?? matches.length, alreadyViewed: viewed.length}); setJobs(matches.filter((job) => !likedIds.has(job.id) && !seenIds.has(job.id))); setStatus('ready') } catch (e) { if (requestId !== requestSequence.current || e.name === 'AbortError') return; setJobs([]); setError(e.message || 'Ошибка сети'); setStatus('error') } finally { if (requestController.current === controller) requestController.current = null } }
  useEffect(() => { if (tab !== 'feed') return; load(); return () => { requestSequence.current += 1; requestController.current?.abort(); requestController.current = null } }, [tab])
  useEffect(() => { if (reloadAfterClear.current) { reloadAfterClear.current = false; if (tab === 'feed') load() } }, [liked, seen, history])
  function decide(like) { if (!current) return; const reaction = like ? 'liked' : 'skipped'; if (like) setLiked((all) => likedIds.has(current.id) ? all : [...all, current]); setSeen((ids) => ids.includes(current.id) ? ids : [...ids, current.id]); setHistory((entries) => [{job: current, reaction, viewedAt: Date.now()}, ...entries.filter((entry) => entry.job.id !== current.id)]); setIndex((i) => i + 1) }
  function restoreToLiked(entry) { setLiked((all) => likedIds.has(entry.job.id) ? all : [...all, entry.job]); setHistory((entries) => entries.map((item) => item.job.id === entry.job.id ? {...item, reaction: 'liked'} : item)) }
  function clearHistoryAndFavorites() {
    if (!window.confirm('Очистить историю и избранное? Профиль и фильтры сохранятся.')) return
    requestSequence.current += 1
    reloadAfterClear.current = true
    clearTimeout(exitTimer.current)
    pointer.current = null; decisionLocked.current = false
    setOutgoing(null); setMotion({x: 0, y: 0, dragging: false, exiting: false})
    setLiked([]); setSeen([]); setHistory([]); setSelected([])
    localStorage.removeItem(LIKED_KEY); localStorage.removeItem(SEEN_KEY); localStorage.removeItem(HISTORY_KEY)
  }
  function animateDecision(like, from = motion) {
    if (!current || decisionLocked.current) return
    decisionLocked.current = true
    pointer.current = null
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      decide(like)
      setMotion({x: 0, y: 0, dragging: false, exiting: false})
      return
    }
    setOutgoing(current)
    setMotion({x: (like ? 1 : -1) * (window.innerWidth + 300), y: from.y, dragging: false, exiting: true})
    decide(like)
    exitTimer.current = setTimeout(() => {
      setOutgoing(null)
      setMotion({x: 0, y: 0, dragging: false, exiting: false})
    }, 300)
  }
  function pointerDown(event) {
    if (decisionLocked.current || !event.isPrimary || event.button !== 0 || event.target.closest('a, button, input, select, textarea')) return
    pointer.current = {id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false}
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function pointerMove(event) {
    const start = pointer.current
    if (!start || start.id !== event.pointerId || decisionLocked.current) return
    const x = event.clientX - start.x, y = event.clientY - start.y
    if (!start.dragging) {
      if (Math.abs(y) > 8 && Math.abs(y) > Math.abs(x)) { pointer.current = null; return }
      if (Math.abs(x) <= 8 || Math.abs(x) <= Math.abs(y)) return
      start.dragging = true
    }
    setMotion({x, y, dragging: true, exiting: false})
  }
  function pointerUp(event) {
    const start = pointer.current
    if (!start || start.id !== event.pointerId) return
    pointer.current = null
    const x = event.clientX - start.x, y = event.clientY - start.y
    if (start.dragging && Math.abs(x) > 65) animateDecision(x > 0, {x, y})
    else setMotion({x: 0, y: 0, dragging: false, exiting: false})
  }
  function cancelPointer(event) {
    if (!pointer.current || pointer.current.id !== event.pointerId) return
    pointer.current = null
    setMotion({x: 0, y: 0, dragging: false, exiting: false})
  }
  const displayedJob = outgoing || current
  const cardStyle = {transform: `translate3d(${motion.x}px, ${motion.y}px, 0) rotate(${Math.max(-12, Math.min(12, motion.x / 20))}deg)`}
  const nav = [['feed', 'Лента', 'feed'], ['liked', 'Понравившиеся', 'heart'], ['history', 'История', 'history'], ['notifications', 'Уведомления', 'bell']]
  return <div className="app"><aside><strong><i>✦</i> JobPilot</strong><p>Найдите работу, которая вам подходит.</p><Nav items={nav} tab={tab} setTab={setTab} count={liked.length}/><button className={tab === 'profile' ? 'profile-nav active' : 'profile-nav'} onClick={() => setTab('profile')}><Icon name="user"/><span>Профиль</span></button></aside><main>
    {tab === 'feed' && <section className="feed"><header><div><em>Новые возможности</em><h1>Лента вакансий</h1></div><button className="round" onClick={load} disabled={Boolean(outgoing) || status === 'loading'}><RefreshCw/></button></header>{sourceErrors.map((item) => <div className="source-error" key={item.source}>Источник {item.source}: {item.detail} ({item.status})</div>)}{status === 'disabled' && <div className="state"><b>API отключён</b><span>Включите «Работу России» в профиле для загрузки реальных вакансий.</span></div>}{status === 'loading' && <div className="state">Ищем актуальные вакансии…</div>}{status === 'source-error' && <Empty icon="x" title="Ошибка источника" text="«Работа России» не вернула вакансии. Повторите попытку позже."/>}{status === 'error' && <div className="state error"><b>Не удалось загрузить вакансии</b><span>{error}</span><button onClick={load}>Попробовать снова</button></div>}{status === 'ready' && displayedJob && <><article key={displayedJob.id} className={`card${motion.dragging ? ' dragging' : ''}${motion.exiting ? ' exiting' : ''}`} style={cardStyle} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}><div className="cardtop"><b>{displayedJob.source}</b><span>← свайп · свайп →</span></div><h2>{displayedJob.title}</h2><p>{displayedJob.company || 'Компания не указана'}</p><h3>{salary(displayedJob)}</h3><div className="meta">⌖ {displayedJob.city || 'Город не указан'} <span>·</span> {profile.format === 'any' ? 'Любой' : profile.format}</div><a href={displayedJob.url} target="_blank" rel="noreferrer">Открыть источник ↗</a></article><div className="decisions"><button disabled={Boolean(outgoing)} onClick={() => animateDecision(false)}>← Пропустить</button><button disabled={Boolean(outgoing)} onClick={() => animateDecision(true)}>Нравится →</button></div></>}{status === 'ready' && !displayedJob && stats.matched === 0 && <Empty icon="feed" title="Нет вакансий по вашим фильтрам" text={`Источник проверил ${stats.source} вакансий. Измените фильтры в профиле и обновите ленту.`}/>} {status === 'ready' && !displayedJob && stats.matched > 0 && <Empty icon="feed" title="Все найденные вакансии просмотрены" text={`Из ${stats.matched} совпадений уже просмотрено: ${stats.alreadyViewed}. Измените фильтры или сбросьте историю просмотра.`}/>}</section>}
    {tab === 'liked' && <section><header><div><em>Ваша подборка</em><h1>Понравившиеся</h1></div></header>{!liked.length ? <Empty icon="heart" title="Здесь появятся ваши находки" text="Ставьте лайк вакансиям в ленте, чтобы вернуться к ним позже."/> : <div className="liked">{liked.map((job) => <article key={job.id}><a className="liked-link" href={job.url} target="_blank" rel="noopener noreferrer"><h2>{job.title}</h2><p>{job.company || 'Компания не указана'} · {job.city || 'Город не указан'}</p><b>{salary(job)}</b></a><button className="remove-liked" type="button" aria-label={`Удалить из понравившихся: ${job.title}`} onClick={() => { setLiked((all) => all.filter((item) => item.id !== job.id)); setSelected((all) => all.filter((id) => id !== job.id)) }}><Icon name="x"/></button></article>)}</div>}</section>}
    {tab === 'history' && <section><header><div><em>Ваши действия</em><h1>История</h1></div></header>{!history.length ? <Empty icon="history" title="История пока пуста" text="Просмотренные вакансии и ваши реакции появятся здесь."/> : <div className="history">{history.map((entry) => <article key={entry.job.id}><a className="history-link" href={entry.job.url} target="_blank" rel="noopener noreferrer"><span className={entry.reaction === 'liked' ? 'reaction liked' : 'reaction skipped'}>{entry.reaction === 'liked' ? 'Нравится' : 'Пропущено'}</span><h2>{entry.job.title}</h2><p>{entry.job.company || 'Компания не указана'} · {entry.job.city || 'Город не указан'}</p><b>{salary(entry.job)}</b></a>{entry.reaction === 'skipped' && <button onClick={() => restoreToLiked(entry)}>В понравившиеся</button>}</article>)}</div>}</section>}
    {tab === 'notifications' && <section><header><div><em>Следите за лентой</em><h1>Уведомления</h1></div></header><Empty icon="bell" title="Уведомлений пока нет" text="Мы пока не отправляем уведомления о новых вакансиях."/></section>}
    {tab === 'responses' && <section><header><div><em>Контроль процесса</em><h1>Отклики</h1></div></header><Empty icon="send" title="Откликов пока нет" text="Выберите вакансии в понравившихся — здесь появится история ваших откликов."/></section>}
    {tab === 'profile' && <section><header><div><em>Настройки поиска</em><h1>Ваш профиль</h1></div></header><form className="profile" onSubmit={(event) => { event.preventDefault(); localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); setProfileSaved(true); }}>{[['profession', 'Профессия', 'Например, Python-разработчик'], ['skills', 'Навыки', 'FastAPI, PostgreSQL, Docker'], ['salary', 'Желаемая зарплата', 'от 180 000 ₽'], ['city', 'Город', 'Москва']].map(([key, label, hint]) => <label key={key}>{label}<input value={profile[key]} placeholder={hint} onChange={(e) => { setProfile({...profile, [key]: e.target.value}); setProfileSaved(false); }}/></label>)}<label>Формат работы<select value={profile.format} onChange={(e) => { setProfile({...profile, format: e.target.value}); setProfileSaved(false); }}><option value="any">Любой</option><option>Удалённо</option><option>Гибрид</option><option>Офис</option></select></label><details className="advanced"><summary>Расширенные фильтры</summary><p>Сохраняются в профиле, но пока не влияют на поиск.</p><div>{advancedFilters.map(([key, label, options]) => <label key={key}>{label}<select value={profile.advanced[key]} onChange={(e) => { setProfile({...profile, advanced: {...profile.advanced, [key]: e.target.value}}); setProfileSaved(false); }}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>)}</div></details><div className="api-choice"><span>Источник вакансий</span><button className={profile.apiEnabled ? 'api-toggle active' : 'api-toggle'} type="button" aria-pressed={profile.apiEnabled} onClick={() => { setProfile({...profile, apiEnabled: !profile.apiEnabled}); setProfileSaved(false); }}>API «Работа России» · {profile.apiEnabled ? 'включён' : 'выключен'}</button></div><div className="profile-actions"><button className="save-profile" type="submit">Сохранить</button><button className="reset-seen" type="button" onClick={() => setSeen([])}>Сбросить просмотренные</button>{profileSaved && <span className="save-notice">Профиль сохранён</span>}</div></form><button className="clear-history" type="button" onClick={clearHistoryAndFavorites}>Очистить историю и избранное</button></section>}
  </main><nav className="mobile"><Nav items={[...nav, ['profile', 'Профиль', 'user']]} tab={tab} setTab={setTab} count={liked.length}/></nav></div>
}
function Nav({ items, tab, setTab, count }) { return <>{items.map(([id, label, icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon name={icon}/><span>{label}</span>{id === 'liked' && count > 0 && <b>{count}</b>}</button>)}</> }
createRoot(document.getElementById('root')).render(<App />)
