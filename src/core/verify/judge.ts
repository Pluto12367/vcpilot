import fs from 'node:fs'
import path from 'node:path'
import type { LlmConfig } from '../../shared/config.js'
import { chat } from '../llm/client.js'
import { extractJSONStrict } from '../llm/json.js'
import type { AcTestResult } from './e2e.js'
import type { AcItem } from '../spec/specs.js'

export type JudgeVerdict = 'pass' | 'fail' | 'uncertain' | 'no-evidence'

export interface JudgeResult {
  ac: string
  verdict: JudgeVerdict
  reason: string
  evidence: 'screenshot' | 'dom-text' | 'test-result'
}

const JUDGE_SYSTEM = `你是严格的验收裁判。逐条对照验收标准,判断给出的证据(页面截图或页面文本)是否满足标准。
判定规则:
- 只依据证据本身,不脑补证据外的行为
- 标准里写了具体文案/数据/状态的,逐字核对
- 证据不足以判定时用 uncertain,不要放水
只输出 JSON:{"verdicts":[{"ac":"AC1","verdict":"pass|fail|uncertain","reason":"一句话依据"}]}`

function evidenceFor(artifactsDir: string, acId: string): { png?: string; dom?: string } {
  const png = path.join(artifactsDir, `${acId}.png`)
  const dom = path.join(artifactsDir, `${acId}.dom.txt`)
  return {
    png: fs.existsSync(png) ? png : undefined,
    dom: fs.existsSync(dom) ? dom : undefined
  }
}

/** 对每条 AC 做证据判定:截图 → 视觉判定;失败降级 DOM 文本;两者皆无 → 看 e2e 结果 */
export async function judgeAcs(opts: {
  acs: AcItem[]
  artifactsDir: string
  e2eResults?: AcTestResult[]
  llm: LlmConfig
  onStep?: (msg: string) => void
}): Promise<JudgeResult[]> {
  const { acs, artifactsDir, e2eResults = [], llm, onStep = () => {} } = opts
  const results: JudgeResult[] = []

  for (const ac of acs) {
    const { png, dom } = evidenceFor(artifactsDir, ac.id)

    if (png) {
      onStep(`${ac.id}:视觉判定(截图)…`)
      const img = fs.readFileSync(png).toString('base64')
      try {
        const raw = await chat(
          {
            system: JUDGE_SYSTEM,
            user: `验收标准:${ac.id}: ${ac.text}\n\n证据:页面全页截图。请判定。`,
            images: [{ base64: img, mime: 'image/png' }],
            json: true,
            maxTokens: 1500,
            temperature: 0.1
          },
          llm
        )
        const parsed = extractJSONStrict<{ verdicts: Array<{ ac: string; verdict: string; reason: string }> }>(raw, '裁判 JSON')
        const v = parsed.verdicts.find((x) => x.ac === ac.id) || parsed.verdicts[0]
        if (v) {
          results.push({ ac: ac.id, verdict: norm(v.verdict), reason: v.reason, evidence: 'screenshot' })
          continue
        }
      } catch (e) {
        // 端点不支持图片 → 降级 DOM 文本
        onStep(`${ac.id}:模型不支持图片输入,降级 DOM 文本判定`)
      }
    }

    if (dom) {
      const text = fs.readFileSync(dom, 'utf8').slice(0, 4000)
      const raw = await chat(
        {
          system: JUDGE_SYSTEM,
          user: `验收标准:${ac.id}: ${ac.text}\n\n证据:页面可见文本(inner):\n"""\n${text}\n"""`,
          json: true,
          maxTokens: 1500,
          temperature: 0.1
        },
        llm
      )
      const parsed = extractJSONStrict<{ verdicts: Array<{ ac: string; verdict: string; reason: string }> }>(raw, '裁判 JSON')
      const v = parsed.verdicts.find((x) => x.ac === ac.id) || parsed.verdicts[0]
      if (v) {
        results.push({ ac: ac.id, verdict: norm(v.verdict), reason: v.reason, evidence: 'dom-text' })
        continue
      }
    }

    // 无证据:看 e2e 测试结果
    const r = e2eResults.find((x) => x.id === ac.id)
    if (r && r.status !== 'not-found') {
      results.push({
        ac: ac.id,
        verdict: r.status === 'passed' ? 'pass' : 'fail',
        reason: r.status === 'passed' ? 'E2E 测试通过(无独立证据)' : `E2E 测试失败:${(r.error || '').slice(0, 120)}`,
        evidence: 'test-result'
      })
    } else {
      results.push({ ac: ac.id, verdict: 'no-evidence', reason: '没有可用的判定证据(无截图/DOM/测试)', evidence: 'test-result' })
    }
  }

  return results
}

function norm(v: string): JudgeVerdict {
  const s = String(v).toLowerCase()
  if (s === 'pass' || s === 'passed') return 'pass'
  if (s === 'fail' || s === 'failed') return 'fail'
  if (s === 'uncertain') return 'uncertain'
  return 'no-evidence'
}
