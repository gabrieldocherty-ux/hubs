/*
 * Appearance before the first paint (src/lib/theme.ts has the full story). A classic script in the
 * <head>, so it runs before the body is drawn: a person who chose Dark (or System on a dark device)
 * never sees a light page flash while the app loads. Same key and attributes as theme.ts.
 */
(function () {
  var pref = 'system';
  try {
    var v = window.localStorage.getItem('blumodel.theme');
    if (v === 'light' || v === 'dark' || v === 'system') pref = v;
  } catch (e) {
    /* storage blocked */
  }
  var dark = false;
  try {
    dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch (e) {
    dark = pref === 'dark';
  }
  var el = document.documentElement;
  el.setAttribute('data-theme', dark ? 'dark' : 'light');
  el.setAttribute('data-theme-pref', pref);
})();
