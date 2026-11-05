/**
 * 性能夹具：按数量生成一张「链 + 扇出」混合的步骤图。
 *
 * 形状刻意贴近真实工作流（不是纯网格）：主干一条链，每隔几个节点扇出 2–3 路再汇回，
 * 这样拖拽时既有关联边重算、也有大片无关节点，能照出「每帧全量重算」的开销。
 *
 * 坐标按 ELK 整理后的典型密度摆（横向 380、纵向 220 一档），避免叠在一起。
 */

/**
 * @param {number} count 步骤数（≥4）
 * @returns {{nodes: Array<object>, edges: Array<object>, viewport: {x:number,y:number,zoom:number}}}
 */
export function buildFixtureGraph(count) {
  if (!Number.isInteger(count) || count < 4) throw new Error(`夹具至少 4 个步骤，得到 ${count}`)
  const nodes = []
  const edges = []
  let col = 0
  let row = 0
  const place = () => {
    const position = { x: col * 380, y: row * 220 }
    return position
  }
  /** 主干上一个节点 id。 */
  let spinePrev = null
  /** 每层扇出的旁路节点，下一层汇回时用。 */
  let sideNodes = []
  let index = 0
  while (index < count) {
    const id = `s${String(index).padStart(4, '0')}`
    nodes.push({
      id,
      type: 'wfNode',
      position: place(),
      data: {
        label: `步骤 ${index}`,
        prompt: `这是性能夹具的第 ${index} 步：读 notes.md，干活，把结果写回 notes.md。`,
      },
    })
    if (spinePrev !== null) edges.push(edge(spinePrev, id))
    for (const side of sideNodes) edges.push(edge(side.id, id))
    spinePrev = id
    row += 1
    index += 1
    sideNodes = []
    // 每 6 个主干节点扇出一次（剩余不足就少扇），旁路挂在下一列。
    if (index % 6 === 0 && count - index >= 2) {
      const fan = Math.min(2, count - index)
      const spineRow = row
      for (let f = 0; f < fan; f += 1) {
        const sideId = `s${String(index).padStart(4, '0')}`
        nodes.push({
          id: sideId,
          type: 'wfNode',
          position: { x: (col + 1) * 380, y: (spineRow + f) * 220 },
          data: { label: `旁路 ${index}-${f}`, prompt: `并行旁路 ${f}：只做一件事然后交回主干。` },
        })
        edges.push(edge(spinePrev, sideId))
        sideNodes.push({ id: sideId })
        index += 1
      }
      col += 1
    }
  }
  return { nodes, edges, viewport: { x: 40, y: 40, zoom: 0.5 } }
}

function edge(source, target) {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
  }
}
