export const scheduleSources = {
  // Map team slug -> list of sources to try (first that returns events wins)
  "chesterfield-a1": [
    {
      type: "ics",
      // ICS link you provided (converted from webcal:// to https:// for Node fetch)
      url: "https://accounts.crossbar.org/calendar/ical/38203?member=0&type=games_only",
      // Used to figure out Home/Away from the event title
      selfName: "Chesterfield 12U A1"
    }
  ],

  // Add more teams here, e.g.:
  // "springfield-a1": [
  //   { type: "ics", url: "https://example.com/springfield.ics", selfName: "Springfield 12U A1" }
  // ],
};
