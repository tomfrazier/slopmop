// Feature modules (weights, clients) need to re-render the page after a change, and the page needs them to draw. To avoid
// modules importing each other in a circle, app.js registers these once at startup.
export const hooks = {
  /** Re-fetch (unless `refetch` is false) and redraw the page. */
  refresh: async (_refetch = true) => {},
  /** Show the sign-in form, optionally with a message. */
  login: (_message) => {},
};
