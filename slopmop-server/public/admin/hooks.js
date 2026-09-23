// Feature modules (weights, clients) need to re-render the page after a change, and the page needs them to draw. To avoid
// modules importing each other in a circle, app.js registers these once at startup.
export const hooks = {
  /** Re-fetch (unless `refetch` is false) and redraw the page. */
  refresh: async (_refetch = true) => {},
  /** Re-fetch the device list (the once-a-minute refresh does this on the Devices page instead of redrawing it). */
  reloadDevices: async () => {},
  /** Re-fetch the error list. */
  reloadErrors: async () => {},
  /** Show the sign-in form, optionally with a message. */
  login: (_message) => {},
};
