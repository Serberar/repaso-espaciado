import { describe, expect, it, vi } from 'vitest'
import type { Question } from './data'

// Sin navegador: localStorage simulado y fecha de examen fija, para que los cálculos no dependan del día
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
import {
  assess,
  buildDaily,
  buildQuiz,
  buildReview,
  dailyPlan,
  dueAt,
  estimateGrade,
  expectedProgress,
  filterQuestions,
  grade,
  gradeBySubject,
  record,
  smartSelect,
  status,
  subjectStats,
  unitWeights,
  weakUnits,
  type Answer,
  type Progress,
  type QuizQuestion,
  toRelearn,
  buildFailed,
  relearnSummary,
} from './quiz'
import { studyStreak, type Attempt } from './store'
import { examDate, setExamIso } from './settings'

await setExamIso('2027-01-28')

const qs: Question[] = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  unit: i < 20 ? 'T1' : 'T2',
  question: `P${i + 1}`,
  options: ['a', 'b', 'c', 'd'],
  correct: 'a',
}))
const q = { ...qs[0], subject: 'A', shuffled: qs[0].options } as QuizQuestion
const ans = (ok: number, wrong: number, skipped: number): Answer[] => [
  ...Array(ok).fill({ q, sel: 'a', ok: true }),
  ...Array(wrong).fill({ q, sel: 'b', ok: false }),
  ...Array(skipped).fill({ q, sel: null, ok: false }),
]

describe('grade', () => {
  it('examen: cada 3 fallos restan 1 acierto, saltadas no penalizan', () => {
    const r = grade(ans(18, 6, 6), 'exam')
    expect(r).toMatchObject({ correct: 18, wrong: 6, skipped: 6, points: 16, grade: 5.33, passed: true })
  })
  it('examen: la puntuación no baja de 0', () => {
    expect(grade(ans(1, 29, 0), 'exam').grade).toBe(0)
  })
  it('práctica: nota = aciertos / total', () => {
    expect(grade(ans(4, 6, 0), 'random')).toMatchObject({ grade: 4, passed: false })
  })
})

describe('selección', () => {
  it('smartSelect devuelve n preguntas distintas', () => {
    const picked = smartSelect(qs, {}, 25)
    expect(new Set(picked.map(p => p.id)).size).toBe(25)
  })
  it('examen usa 30 preguntas aunque se pida otro número', () => {
    expect(buildQuiz('A', qs, {}, 'exam', 5)).toHaveLength(30)
    expect(buildQuiz('A', qs.slice(0, 10), {}, 'exam', 5)).toHaveLength(10)
  })
  it('las opciones barajadas son las mismas', () => {
    for (const b of buildQuiz('A', qs, {}, 'random', 10)) expect([...b.shuffled].sort()).toEqual(b.options)
  })
})

describe('progreso', () => {
  it('record y subjectStats', () => {
    let p = record({}, 1, true)
    p = record(p, 2, false)
    p = record(p, 2, false)
    expect(subjectStats(qs, p)).toEqual({ total: 40, seen: 2, failed: 1, accuracy: 33 })
  })
  it('fallada = última respuesta mal; progreso antiguo sin l usa fallos > aciertos', () => {
    let p = record({}, 1, false)
    p = record(p, 1, true)
    expect(status(p[1])).toBe('ok')
    expect(status(record(p, 1, false)[1])).toBe('failed')
    expect(status({ c: 1, w: 3 })).toBe('failed')
    expect(status(undefined)).toBe('new')
    const f = record(record({}, 1, true), 2, false)
    expect(filterQuestions(qs, f, 'failed').map(x => x.id)).toEqual([2])
    expect(filterQuestions(qs, f, 'new')).toHaveLength(38)
  })
})

describe('repaso general', () => {
  const big = { name: 'A', questions: qs }
  const small = { name: 'B', questions: qs.slice(0, 3) }
  const other = { name: 'C', questions: qs }
  it('reparte por igual y pasa lo que no cabe a las demás', () => {
    const r = buildReview([big, small, other], {}, 60, true)
    expect(r).toHaveLength(60)
    const per = (n: string) => r.filter(x => x.subject === n).length
    expect(per('B')).toBe(3)
    expect(per('A') + per('C')).toBe(57)
    expect(Math.abs(per('A') - per('C'))).toBeLessThanOrEqual(1)
    for (const n of ['A', 'B', 'C']) expect(new Set(r.filter(x => x.subject === n).map(x => x.id)).size).toBe(per(n))
  })
  it('nota de examen por asignatura', () => {
    const mk = (subject: string, ok: boolean, sel: string | null = ok ? 'a' : 'b'): Answer => ({ q: { ...q, subject }, sel, ok })
    const res = gradeBySubject([mk('B', true), mk('B', false), mk('B', false), mk('B', false), mk('A', true), mk('A', false, null)], 'exam')
    expect(res.map(r => [r.subject, r.grade, r.passed])).toEqual([
      ['A', 5, true],
      ['B', 0, false],
    ])
  })
})

const DAY = 86_400_000
const NOW = new Date(2026, 10, 3, 12).getTime()
const EXAM = new Date(2027, 0, 28).getTime()

describe('repetición espaciada', () => {
  it('fallada toca ya; cada acierto seguido alarga el intervalo; nueva no toca', () => {
    expect(dueAt(undefined, EXAM)).toBeNull()
    let p = record({}, 1, false, NOW)
    expect(dueAt(p[1], EXAM)).toBe(0)
    p = record(p, 1, true, NOW)
    expect(dueAt(p[1], EXAM)).toBe(NOW + DAY)
    p = record(p, 1, true, NOW + DAY)
    expect(dueAt(p[1], EXAM)).toBe(NOW + 4 * DAY)
    p = record(p, 1, false, NOW + DAY)
    expect(p[1]).toMatchObject({ c: 2, w: 2, s: 0, l: false, f: NOW })
  })
  it('el intervalo no pasa de la mitad del tiempo hasta el examen', () => {
    const t = EXAM - 10 * DAY
    expect(dueAt({ c: 9, w: 0, l: true, s: 9, t }, EXAM)).toBe(t + 5 * DAY)
  })
})

describe('sesión diaria', () => {
  const pool = (name: string, progress: Progress = {}) => ({ name, questions: qs, progress })
  it('objetivo de nuevas para verlo todo 2 semanas antes del examen', () => {
    const plan = dailyPlan([{ name: 'A', total: 40, progress: {} }], NOW)
    expect(plan.daysLeft).toBe(86)
    expect(plan.newTarget).toBe(1) // 40 / 72 días
    expect(plan.due).toBe(0)
  })
  it('las falladas entran primero y el bloque no repite preguntas', () => {
    let p: Progress = {}
    for (let i = 1; i <= 5; i++) p = record(p, i, false, NOW - DAY)
    const block = buildDaily([pool('A', p), pool('B')], NOW, 10)
    expect(block).toHaveLength(20)
    expect(new Set(block.map(b => b.subject + b.id)).size).toBe(20)
    for (let i = 1; i <= 5; i++) expect(block.some(b => b.subject === 'A' && b.id === i)).toBe(true)
  })
  it('con muchos repasos y el objetivo cumplido sigue metiendo nuevas', () => {
    let p: Progress = {}
    for (let i = 1; i <= 30; i++) p = record(p, i, false, NOW) // 30 falladas hoy: objetivo de nuevas ya cubierto
    const block = buildDaily([pool('A', p)], NOW, 20)
    const fresh = block.filter(b => status(p[b.id]) === 'new').length
    expect(fresh).toBe(10)
    expect(block.length - fresh).toBe(10)
  })
  it('las nuevas avanzan por temas en orden y el bloque va agrupado por tema', () => {
    let p: Progress = {}
    for (let i = 1; i <= 15; i++) p = record(p, i, true, NOW) // T1 casi vista
    const block = buildDaily([pool('A', p)], NOW, 20)
    const fresh = block.filter(b => status(p[b.id]) === 'new')
    expect(fresh.filter(b => b.unit === 'T1').length).toBe(5) // primero se acaba T1
    const units = block.map(b => b.unit)
    expect(units).toEqual([...units].sort())
  })
  it('5 de cada asignatura; si una no tiene nada, otras cubren el hueco', () => {
    const block = buildDaily([pool('A'), pool('B'), pool('C')], NOW)
    expect(block.length).toBe(15)
    for (const n of ['A', 'B', 'C']) expect(block.filter(b => b.subject === n).length).toBe(5)
    let all: Progress = {}
    for (const q of qs) all = record(all, q.id, true, NOW) // A todo visto y al día
    const mixed = buildDaily([pool('A', all), pool('B')], NOW)
    expect(mixed.length).toBe(10)
    expect(mixed.filter(b => b.subject === 'B').length).toBe(10)
  })
  it('con todo visto y al día sigue con 5 de cada asignatura, las menos asentadas primero', () => {
    let a: Progress = {}
    for (const q of qs.slice(0, 5)) a = record(a, q.id, true, NOW - 3 * DAY)
    for (const q of qs) a = record(a, q.id, true, NOW) // 1-5 con 2 aciertos seguidos (en días distintos)
    const block = buildDaily([pool('A', a), pool('B', a)], NOW)
    for (const n of ['A', 'B']) {
      const mine = block.filter(b => b.subject === n)
      expect(mine.length).toBe(5)
      expect(mine.every(b => b.id > 5)).toBe(true)
    }
  })
})

describe('preguntas al día', () => {
  it('reparte lo que falta (6 respuestas por pregunta) entre los días hasta el examen', () => {
    const now = examDate().getTime() - 10 * DAY
    const empty = dailyPlan([{ name: 'A', total: 100, progress: {} }], now)
    expect(empty.perDay).toBe(60)
    expect(empty.leftToday).toBe(60)
    // Responder una nueva hoy no cambia el objetivo del día, solo lo que falta
    const one = dailyPlan([{ name: 'A', total: 100, progress: record({}, 1, true, now) }], now)
    expect(one.perDay).toBe(60)
    expect(one.leftToday).toBe(59)
  })
})

describe('ritmo esperado', () => {
  it('sube a ritmo constante hasta 2 semanas antes del examen', () => {
    const end = examDate().getTime() - 14 * DAY
    const start = end - 100 * DAY
    expect(expectedProgress(null, start)).toBeNull()
    expect(expectedProgress(start, start)).toBeCloseTo(0.01)
    expect(expectedProgress(start, start + 49 * DAY)).toBeCloseTo(0.5)
    expect(expectedProgress(start, end + 5 * DAY)).toBe(1)
  })
})

describe('nota estimada', () => {
  it('nada visto = 0; todo bien asentado = cerca de 10', () => {
    expect(estimateGrade({}, 40)).toBe(0)
    let p: Progress = {}
    for (const q of qs) for (let k = 0; k < 4; k++) p = record(p, q.id, true, NOW - (3 - k) * DAY)
    expect(estimateGrade(p, 40)).toBeGreaterThan(9)
  })
})

describe('racha de días', () => {
  const at = (d: number) => ({ created_at: new Date(NOW - d * DAY).toISOString() }) as Attempt
  it('cuenta días seguidos hasta hoy o ayer', () => {
    expect(studyStreak([at(0), at(1), at(2), at(4)], new Date(NOW))).toBe(3)
    expect(studyStreak([at(1), at(2)], new Date(NOW))).toBe(2)
    expect(studyStreak([at(3)], new Date(NOW))).toBe(0)
  })
})

describe('¿cómo voy?', () => {
  const subj = (progress: Progress) => [{ name: 'A', total: 400, progress }]
  it('sin estudiar: ritmo mal y veredicto no es bien', () => {
    const r = assess(subj({}), NOW)
    expect(r.pace).toBe('bad')
    expect(r.finishAt).toBeNull()
    expect(r.verdict).not.toBe('good')
  })
  it('buen ritmo, buena retención y sin atrasos: bien', () => {
    let p: Progress = {}
    // 70 nuevas esta semana (10/día > 6/día necesarias), todas acertadas hace poco
    for (let i = 1; i <= 70; i++) p = record(p, i, true, NOW - (i % 7) * DAY / 7)
    const r = assess(subj(p), NOW)
    expect(r.perDay).toBe(10)
    expect(r.pace).toBe('good')
    expect(r.memory).toBe('good')
    expect(r.verdict).toBe('good')
    expect(r.finishAt).toBe(new Date(2026, 10, 3).getTime() + 33 * DAY)
  })
  it('muchas falladas: retención mal', () => {
    let p: Progress = {}
    for (let i = 1; i <= 40; i++) p = record(p, i, i % 3 === 0, NOW - DAY)
    expect(assess(subj(p), NOW).memory).toBe('bad')
  })
})

describe('temas flojos', () => {
  it('el tema con más falladas pesa más y sale más entre las nuevas', () => {
    let p: Progress = {}
    // T1 (1-20): 5 vistas y falladas; T2 (21-40): 5 vistas y acertadas
    for (let i = 1; i <= 5; i++) p = record(p, i, false, NOW - DAY)
    for (let i = 21; i <= 25; i++) p = record(p, i, true, NOW - DAY)
    const w = unitWeights(qs, p)
    expect(w.get('T1')!).toBeGreaterThan(w.get('T2')!)
    let t1 = 0, t2 = 0
    for (let r = 0; r < 200; r++) for (const q of smartSelect(qs.filter(q => !p[q.id]), p, 5, qs)) {
      if (q.unit === 'T1') t1++
      else t2++
    }
    expect(t1).toBeGreaterThan(t2)
    expect(weakUnits([{ name: 'A', questions: qs, progress: p }])).toEqual([{ subject: 'A', unit: 'T1', seen: 5, failed: 5, rate: 1 }])
  })
})

describe('toRelearn', () => {
  it('una fallada sale solo tras dos aciertos seguidos', () => {
    const day = (d: number) => new Date(2026, 10, d, 12).getTime()
    let p = record({}, 1, false, day(1))
    expect(toRelearn(p[1])).toBe(true)
    p = record(p, 1, true, day(2))
    expect(toRelearn(p[1])).toBe(true)
    p = record(p, 1, false, day(3))
    p = record(p, 1, true, day(4))
    p = record(p, 1, true, day(5))
    expect(toRelearn(p[1])).toBe(false)
  })
  it('dos aciertos el mismo día cuentan como uno', () => {
    const now = new Date(2026, 10, 19, 12).getTime()
    let p = record({}, 1, false, now - 86_400_000)
    p = record(p, 1, true, now)
    p = record(p, 1, true, now + 1000)
    expect(p[1].s).toBe(1)
    expect(toRelearn(p[1])).toBe(true)
  })
  it('las nuevas y las nunca falladas no entran', () => {
    expect(toRelearn(undefined)).toBe(false)
    expect(toRelearn(record({}, 1, true)[1])).toBe(false)
    expect(toRelearn({ c: 1, w: 1, l: true })).toBe(false) // progreso antiguo sin racha
  })
})

describe('buildFailed', () => {
  const DAY = 86_400_000
  const now = new Date(2026, 10, 19, 12).getTime()
  const qs = [1, 2, 3].map(id => ({ id, question: 'q' + id, options: ['a', 'b'], correct: 'a' }) as Question)
  it('las acertadas hoy esperan a mañana', () => {
    let p = record({}, 1, false, now - 2 * DAY)
    p = record(p, 1, true, now - 1000) // 1 acierto hoy
    p = record(p, 2, false, now - DAY)
    p = record(p, 2, true, now - DAY) // 1 acierto ayer
    p = record(p, 3, false, now - 1000) // fallada hoy
    const all = { S: p }
    const ids = buildFailed([{ name: 'S', questions: qs }], all, now).map(q => q.id).sort()
    expect(ids).toEqual([2, 3])
    expect(relearnSummary(all, {}, now)).toEqual({ failed: 1, pending: 2, today: 2 })
    expect(relearnSummary(all, { S: new Set([1, 2]) }, now)).toEqual({ failed: 0, pending: 2, today: 1 }) // la 3 ya no existe
  })
  it('limita el bloque y pone primero las falladas', () => {
    let p = record({}, 1, false, now - DAY)
    p = record(p, 1, true, now - DAY)
    p = record(p, 2, false, now - DAY)
    const ids = buildFailed([{ name: 'S', questions: qs }], { S: p }, now, 1).map(q => q.id)
    expect(ids).toEqual([2])
  })
})
