/**
 * Timer helper.
 *
 * In a Chrome service worker `setTimeout` returns a number; under Node (tests)
 * it returns a `Timeout` object that keeps the process alive. Calling `unref()`
 * where available lets the test runner exit as soon as the assertions are done,
 * without changing browser behaviour at all.
 */

/**
 * @param {Function} callback
 * @param {number} ms
 * @returns {*} the timer handle (number in the browser, Timeout in Node)
 */
export function setUnrefTimeout(callback, ms) {
  const timer = setTimeout(callback, ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}
