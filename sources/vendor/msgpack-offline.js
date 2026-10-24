// The upstream repository intentionally omits its private game server.
// Keep the browser build self-contained while the server URL is unset.
const unavailable = () => {
    throw new Error('The private portfolio server is not included in this source bundle.')
}

export default { encode: unavailable, decode: unavailable }
