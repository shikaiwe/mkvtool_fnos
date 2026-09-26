// Matroska 章节 XML 的解析与生成（mkvextract 输出 / mkvmerge --chapters / mkvpropedit --chapters 输入格式）。
// 说明：仅处理每个 Edition 顶层的 ChapterAtom（嵌套子章节暂不支持，个人使用场景足够）。

export function parseTimeToSeconds(ts) {
  // 00:01:02.000000000 → 62
  const m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(ts || '')
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export function secondsToTimestamp(sec) {
  if (sec == null || Number.isNaN(sec)) return '00:00:00.000000000'
  const total = Math.max(0, sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = s.toFixed(9).padStart(12, '0')
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${ss}`
}

function tagText(block, tag) {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block)
  return m ? m[1].trim() : ''
}

export function parseChaptersXml(xml) {
  const editions = []
  const editionRe = /<EditionEntry>([\s\S]*?)<\/EditionEntry>/g
  let edMatch
  while ((edMatch = editionRe.exec(xml))) {
    const editionBlock = edMatch[1]
    // 去掉嵌套 ChapterAtom：仅取顶层（顶层 atom 内可能包含子 atom，简单起见按成对标签剥离）
    const atoms = []
    const atomRe = /<ChapterAtom>([\s\S]*?)<\/ChapterAtom>/g
    let m
    while ((m = atomRe.exec(editionBlock))) atoms.push(m[1])
    // 顶层 atom = 深度 1：用简单的深度扫描而非正则，处理无嵌套的常见输出
    const chapters = atoms
      .filter((block) => !block.includes('<ChapterAtom>'))
      .map((block) => {
        const displays = [...block.matchAll(/<ChapterDisplay>([\s\S]*?)<\/ChapterDisplay>/g)].map(
          (d) => ({
            string: tagText(d[1], 'ChapterString'),
            language: tagText(d[1], 'ChapterLanguage') || 'und',
          })
        )
        return {
          start: tagText(block, 'ChapterTimeStart'),
          end: tagText(block, 'ChapterTimeEnd'),
          title: displays[0]?.string || '',
          language: displays[0]?.language || 'und',
          startSec: parseTimeToSeconds(tagText(block, 'ChapterTimeStart')),
          endSec: parseTimeToSeconds(tagText(block, 'ChapterTimeEnd')),
        }
      })
    editions.push({ name: tagText(editionBlock, 'EditionName') || '', chapters })
  }
  if (editions.length === 0 && xml.includes('<ChapterAtom>')) {
    // 无 EditionEntry 包裹的裸 atom
    const atoms = [...xml.matchAll(/<ChapterAtom>([\s\S]*?)<\/ChapterAtom>/g)]
      .map((m) => m[1])
      .filter((block) => !block.includes('<ChapterAtom>'))
    if (atoms.length) {
      editions.push({
        name: '',
        chapters: atoms.map((block) => ({
          start: tagText(block, 'ChapterTimeStart'),
          end: tagText(block, 'ChapterTimeEnd'),
          title: tagText(block, 'ChapterString'),
          language: tagText(block, 'ChapterLanguage') || 'und',
          startSec: parseTimeToSeconds(tagText(block, 'ChapterTimeStart')),
          endSec: parseTimeToSeconds(tagText(block, 'ChapterTimeEnd')),
        })),
      })
    }
  }
  return editions
}

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function buildChaptersXml(editions) {
  const parts = ['<?xml version="1.0"?>', '<Chapters>']
  const list = editions?.length ? editions : [{ name: '', chapters: [] }]
  for (const ed of list) {
    parts.push('  <EditionEntry>')
    // 注意：mkvtoolnix 的章节 XML 格式没有 edition 名称元素（EditionEntry 仅接受
    // EditionUID/EditionFlag*/ChapterAtom），写入 <EditionName> 会导致整个文件被拒（exit 2）。
    // edition 名称只存在于应用内部模型，这里不输出。
    for (const ch of ed.chapters || []) {
      parts.push('    <ChapterAtom>')
      parts.push(`      <ChapterTimeStart>${esc(secondsToTimestamp(ch.startSec))}</ChapterTimeStart>`)
      if (ch.endSec != null) {
        parts.push(`      <ChapterTimeEnd>${esc(secondsToTimestamp(ch.endSec))}</ChapterTimeEnd>`)
      }
      parts.push('      <ChapterDisplay>')
      parts.push(`        <ChapterString>${esc(ch.title)}</ChapterString>`)
      parts.push(`        <ChapterLanguage>${esc(ch.language || 'und')}</ChapterLanguage>`)
      parts.push('      </ChapterDisplay>')
      parts.push('    </ChapterAtom>')
    }
    parts.push('  </EditionEntry>')
  }
  parts.push('</Chapters>', '')
  return parts.join('\n')
}
