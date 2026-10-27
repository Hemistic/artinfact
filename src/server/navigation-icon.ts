// Reuse the original Artinfact homepage mark for the host navigation entry.
const mark = "<svg width=\"64\" height=\"64\" viewBox=\"0 -20 504 504\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" color=\"#000\" role=\"img\" aria-labelledby=\"title desc\">\n  <title id=\"title\">PAIQ logo mark</title>\n  <desc id=\"desc\">A sharp abstract A-shaped paper mark with four separated parallel strokes.</desc>\n  <g fill=\"currentColor\">\n    <path d=\"M222 19L303 212L222 423H64L222 19Z\"/>\n\n    <path d=\"M235 20H243L323 212H315L235 20Z\"/>\n    <path d=\"M254 20H262L342 212H334L254 20Z\"/>\n    <path d=\"M273 20H281L361 212H353L273 20Z\"/>\n    <path d=\"M292 20H300L380 212H372L292 20Z\"/>\n\n    <path d=\"M322 227H330L333 236H325L322 227Z\"/>\n    <path d=\"M341 227H349L352 236H344L341 227Z\"/>\n    <path d=\"M360 227H368L371 236H363L360 227Z\"/>\n    <path d=\"M379 227H387L390 236H382L379 227Z\"/>\n\n    <path d=\"M333 251H341L412 423H404L333 251Z\"/>\n    <path d=\"M352 251H360L431 423H423L352 251Z\"/>\n    <path d=\"M371 251H379L450 423H442L371 251Z\"/>\n    <path d=\"M390 251H398L469 423H461L390 251Z\"/>\n  </g>\n</svg>";
const icon = (color: string, theme?: 'light' | 'dark') => ({
  src: 'data:image/svg+xml;base64,' + Buffer.from(mark.replace('color="#000"', `color="${color}"`)).toString('base64'),
  mimeType: 'image/svg+xml', sizes: ['any'], ...(theme ? { theme } : {}),
});
// Some hosts use the unthemed fallback even in dark mode.
export const artinfactNavigationIcons = [icon('#ffffff'), icon('#404040', 'light'), icon('#ffffff', 'dark')];
