export function edgeEmphasis(edge: { source: string; target: string }, options: {
  hovered: string; selected: string; baseColor: string; focusColor: string; scale: number;
}) {
  const focus = options.hovered || options.selected;
  const active = !!focus && (edge.source === focus || edge.target === focus);
  return { active, alpha: active ? .58 : focus ? .065 : .13,
    color: active ? options.focusColor : options.baseColor,
    width: (active ? 1.35 : .8) / options.scale };
}
