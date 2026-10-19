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
  // The browser's toolbar and canvas colour (theme.ts THEME_CHROME; the metas sit above this script).
  try {
    var tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', dark ? '#161411' : '#f3eee5');
    var cs = document.querySelector('meta[name="color-scheme"]');
    if (cs) cs.setAttribute('content', dark ? 'dark' : 'light');
  } catch (e) {
    /* nothing to update */
  }
})();
