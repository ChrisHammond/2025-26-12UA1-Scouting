export type PortalSettings = {
  /** Big name in the header/title */
  portalName: string;
  /** Your team’s display name & slug */
  teamName: string;
  teamSlug: string;
  /** League & division you want to feature on the homepage table */
  leagueName: string;
  divisionName: string;
  companyName: string;
  timeZone: string;
};

// Prefer PUBLIC_ env vars (work locally & on Netlify) and fall back to sensible defaults.
const settings: PortalSettings = {
  portalName: import.meta.env.PUBLIC_PORTAL_NAME ?? "Chesterfield Falcons 12U A1 Scouting Portal",
  teamName: import.meta.env.PUBLIC_TEAM_NAME ?? "Chesterfield 12U A1",
  teamSlug: import.meta.env.PUBLIC_TEAM_SLUG ?? "chesterfield-a1",
  leagueName: import.meta.env.PUBLIC_LEAGUE_NAME ?? "MO Hockey",
  divisionName: import.meta.env.PUBLIC_DIVISION_NAME ?? "12U A1",
  companyName: import.meta.env.PUBLIC_COMPANY_NAME ?? "Christoc.com",

    /** Always format dates/times in this zone */
  timeZone: "America/Chicago",
};

export default settings;
