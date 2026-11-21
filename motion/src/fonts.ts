import {continueRender, delayRender, staticFile} from 'remotion';

// Same self-hosted families as the web app (public/fonts), so motion and UI
// share one typographic voice. Rendering waits until every face is ready.
const faces: Array<[string, string, string]> = [
  ['Russo One', 'fonts/russo-one-400.ttf', '400'],
  ['Manrope', 'fonts/manrope-400.ttf', '400'],
  ['Manrope', 'fonts/manrope-600.ttf', '600'],
  ['Manrope', 'fonts/manrope-800.ttf', '800'],
];

const handle = delayRender('Loading Pastty fonts');
Promise.all(
  faces.map(async ([family, file, weight]) => {
    const face = new FontFace(family, `url(${staticFile(file)})`, {weight});
    (document.fonts as unknown as {add: (f: FontFace) => void}).add(await face.load());
  }),
)
  .then(() => continueRender(handle))
  .catch((error) => {
    console.error(error);
    continueRender(handle);
  });
