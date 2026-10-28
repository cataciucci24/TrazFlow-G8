// next/font's supported test hook: keep browser tests independent of Google.
// Production continues to use the Geist fonts configured in app/layout.tsx.
module.exports = new Proxy({}, {
  get(_target, url) {
    if (typeof url !== 'string' || !url.startsWith('https://fonts.googleapis.com/')) return undefined;
    const mono = url.includes('Geist+Mono');
    return `@font-face { font-family: '${mono ? 'Geist Mono' : 'Geist'}'; src: local('${mono ? 'Consolas' : 'Arial'}'); font-weight: 100 900; font-style: normal; }`;
  },
});
