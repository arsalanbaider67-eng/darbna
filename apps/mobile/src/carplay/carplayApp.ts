/**
 * Darbna on CarPlay (navigation app). Apple draws the panels and buttons (CarPlay templates);
 * Darbna draws the map (CarMap) and supplies the content. Everything runs through the phone's
 * own logic via carBridge: the same routes, guidance engine, voice prompts, reports and points.
 *
 *  - Map (root): bar buttons Search · Destinations | Report.
 *  - Search: CarPlay keyboard / dictation → Darbna search → pick → route choices on the map.
 *  - Destinations: home, work, saved and recent places.
 *  - Trip preview: Apple's route-choice panel with Darbna's routes; "Go" starts the trip.
 *  - Driving: Apple's maneuver panel (Darbna arrow + instruction + distance), trip estimates,
 *    "End" button; voice comes from the phone's guidance (same recorded prompts).
 *  - Report: one-tap grid of the 8 main categories (Darbna marker icons).
 *  - Confirmed driver reports ahead: "still there?" alert → the same +2 confirm / gone vote.
 */
import { processColor, type ImageSourcePropType } from "react-native";
import {
  CarPlay, GridTemplate, ListTemplate, MapTemplate, ManeuverType, NavigationAlertActionStyle, SearchTemplate, Trip,
  type ListItem, type Maneuver,
} from "@g4rb4g3/react-native-carplay";
import type { ReportCategory, RouteStep } from "@darbna/core";
import { api } from "../api";
import { fmt, fmtDistance, fmtDuration, instructionText, strings, type FormatCtx } from "../i18n";
import { getState, mergeReports, setState, subscribe } from "../store";
import type { ApiRoute, Place } from "../types";
import { carBridge } from "./bridge";
import { CarMap } from "./CarMap";

const ARROW: Record<string, ImageSourcePropType> = {
  straight: require("../../assets/carplay/straight.png"),
  right: require("../../assets/carplay/right.png"),
  left: require("../../assets/carplay/left.png"),
  slightRight: require("../../assets/carplay/slight-right.png"),
  slightLeft: require("../../assets/carplay/slight-left.png"),
  sharpRight: require("../../assets/carplay/sharp-right.png"),
  sharpLeft: require("../../assets/carplay/sharp-left.png"),
  uturn: require("../../assets/carplay/uturn.png"),
  roundabout: require("../../assets/carplay/roundabout.png"),
  arrive: require("../../assets/carplay/arrive.png"),
};

const REPORT_GRID: ReportCategory[] = ["checkpoint", "checkpoint_slow", "crash", "congestion", "camera", "roadworks", "closure", "flooding"];
const MARKER: Partial<Record<ReportCategory, ImageSourcePropType>> = {
  checkpoint: require("../../assets/markers/checkpoint.png"),
  checkpoint_slow: require("../../assets/markers/checkpoint_slow.png"),
  crash: require("../../assets/markers/crash.png"),
  congestion: require("../../assets/markers/congestion.png"),
  camera: require("../../assets/markers/camera.png"),
  roadworks: require("../../assets/markers/roadworks.png"),
  closure: require("../../assets/markers/closure.png"),
  flooding: require("../../assets/markers/flooding.png"),
};

/** Darbna's maneuver kinds → arrow image + CarPlay maneuver type (for clusters / head-up displays). */
function maneuverLook(step: RouteStep): { image: ImageSourcePropType; type: ManeuverType } {
  switch (step.kind) {
    case "right": return { image: ARROW.right, type: ManeuverType.RightTurn };
    case "left": return { image: ARROW.left, type: ManeuverType.LeftTurn };
    case "slight_right": case "keep_right": case "ramp_right": case "exit_right": return { image: ARROW.slightRight, type: step.kind === "keep_right" ? ManeuverType.KeepRight : step.kind === "exit_right" ? ManeuverType.HighwayOffRampRight : ManeuverType.SlightRightTurn };
    case "slight_left": case "keep_left": case "ramp_left": case "exit_left": return { image: ARROW.slightLeft, type: step.kind === "keep_left" ? ManeuverType.KeepLeft : step.kind === "exit_left" ? ManeuverType.HighwayOffRampLeft : ManeuverType.SlightLeftTurn };
    case "sharp_right": return { image: ARROW.sharpRight, type: ManeuverType.SharpRightTurn };
    case "sharp_left": return { image: ARROW.sharpLeft, type: ManeuverType.SharpLeftTurn };
    case "uturn": return { image: ARROW.uturn, type: ManeuverType.UTurn };
    case "roundabout": case "roundabout_exit": return { image: ARROW.roundabout, type: ManeuverType.EnterRoundabout };
    case "arrive": case "waypoint": return { image: ARROW.arrive, type: ManeuverType.ArriveAtDestination };
    case "depart": return { image: ARROW.straight, type: ManeuverType.StartRoute };
    default: return { image: ARROW.straight, type: ManeuverType.StraightAhead };
  }
}

const lang = () => getState().settings.lang;
const T = () => strings(lang());
const ctx = (): FormatCtx => ({ lang: lang(), digits: getState().settings.digits });

let map: MapTemplate | null = null;
let shownPreview: unknown = null;
let previewTrip: Trip | null = null;
let navTrip: Trip | null = null;
let navRouteId: string | null = null;
let lastManeuverKey = "";
let lastEstimateAt = 0;
let unsubs: (() => void)[] = [];
// Navigation alerts: which report each "still there?" alert is about.
let alertSeq = 1;
const alertReport = new Map<number, string>();
const askedReports = new Set<string>();

export function startCarPlayApp(): void {
  CarPlay.registerOnConnect(onConnect);
  CarPlay.registerOnDisconnect(onDisconnect);
}

function browseButtons() {
  const c = T().car;
  return {
    leadingNavigationBarButtons: [{ id: "search", type: "text" as const, title: c.search }, { id: "destinations", type: "text" as const, title: c.destinations }],
    trailingNavigationBarButtons: [{ id: "report", type: "text" as const, title: c.report }],
  };
}

function driveButtons() {
  const c = T().car;
  return {
    leadingNavigationBarButtons: [{ id: "report", type: "text" as const, title: c.report }],
    trailingNavigationBarButtons: [{ id: "end", type: "text" as const, title: c.end }],
  };
}

function onConnect() {
  map = new MapTemplate({
    component: CarMap,
    guidanceBackgroundColor: processColor("#21194A") ?? undefined,
    tripEstimateStyle: "dark",
    ...browseButtons(),
    onBarButtonPressed: ({ id }) => {
      if (id === "search") openSearch();
      else if (id === "destinations") openDestinations();
      else if (id === "report") openReport();
      else if (id === "end") carBridge.actions()?.end();
    },
    onSelectedPreviewForTrip: ({ routeIndex }) => setState((st) => ({ preview: { ...st.preview, selectedIdx: routeIndex } })),
    onStartedTrip: ({ routeIndex }) => {
      map?.hideTripPreviews();
      shownPreview = null;
      carBridge.actions()?.start(routeIndex);
    },
    onDidCancelNavigation: () => carBridge.actions()?.end(),
    onAlertActionPressed: (e) => {
      const id = alertReport.get(e.navigationAlertId);
      alertReport.delete(e.navigationAlertId);
      if (!id || (!e.primary && !e.secondary)) return;
      void api.vote(id, e.primary ? "confirm" : "gone").then((res) => { if (e.primary && res?.report) mergeReports([res.report]); }).catch(() => {});
    },
  });
  CarPlay.setRootTemplate(map, false);
  unsubs = [subscribe(syncState), carBridge.subscribe(syncLive)];
  syncState();
}

function onDisconnect() {
  unsubs.forEach((u) => u());
  unsubs = [];
  map = null;
  shownPreview = null;
  previewTrip = null;
  navTrip = null;
  navRouteId = null;
  lastManeuverKey = "";
}

// ---------------------------------------------------------------- trip preview and trip state
function tripFor(routes: ApiRoute[], dest: Place): Trip {
  const c = T().car;
  const fix = carBridge.live().fix;
  return new Trip({
    origin: { latitude: fix?.coord[1] ?? dest.coord[1], longitude: fix?.coord[0] ?? dest.coord[0], name: "" },
    destination: { latitude: dest.coord[1], longitude: dest.coord[0], name: dest.name },
    routeChoices: routes.map((r, i) => {
      const head = `${fmtDuration(r.durationS, ctx())} · ${fmtDistance(r.distanceM, ctx())}`;
      const label = i === 0 ? c.fastest : c.alt;
      return {
        summaryVariants: [head],
        additionalInformationVariants: [r.via.length ? `${label} · ${fmt(c.via, { via: r.via.join("، ") })}` : label],
        selectionSummaryVariants: [label],
      };
    }),
  });
}

function syncState() {
  if (!map) return;
  const s = getState();
  const c = T().car;

  // Route choices (from the car or the phone) → Apple's trip preview panel.
  if (s.mode === "preview" && s.preview.result && s.selected && shownPreview !== s.preview.result) {
    shownPreview = s.preview.result;
    previewTrip = tripFor(s.preview.result.routes, s.selected);
    map.showTripPreviews([previewTrip], { startButtonTitle: c.start, additionalRoutesButtonTitle: c.routes, overviewButtonTitle: c.routes });
  } else if (s.mode !== "preview" && shownPreview) {
    shownPreview = null;
    map.hideTripPreviews();
  }

  // Trip started (from the car or the phone) → CarPlay navigation session.
  if (s.mode === "navigating" && s.trip && navRouteId !== s.trip.route.id) {
    navRouteId = s.trip.route.id;
    navTrip = tripFor([s.trip.route], s.trip.destination);
    lastManeuverKey = "";
    void map.startNavigationSession(navTrip);
    map.updateConfig({ ...((map as any).config), ...driveButtons() });
  } else if (s.mode !== "navigating" && navRouteId) {
    navRouteId = null;
    navTrip = null;
    lastManeuverKey = "";
    if (s.mode === "arrived") map.finishNavigationSession(); else map.cancelNavigationSession();
    map.updateConfig({ ...((map as any).config), ...browseButtons() });
  }
}

// ---------------------------------------------------------------- live guidance → maneuver panel
function syncLive() {
  if (!map || !navTrip) return;
  const { guidance: g, ahead } = carBridge.live();
  if (!g || !g.nextStep) return;
  const step = g.nextStep;
  const key = `${navRouteId}:${step.index}`;
  const now = Date.now();
  if (key !== lastManeuverKey) {
    lastManeuverKey = key;
    const look = maneuverLook(step);
    const maneuver: Maneuver = {
      instructionVariants: [instructionText(step, null, ctx())],
      symbolImage: look.image,
      maneuverType: look.type,
      initialTravelEstimates: { distanceRemaining: Math.round(g.distanceToNextM), timeRemaining: Math.round(g.distanceToNextM / 12), distanceUnits: "meters" },
    };
    map.updateManeuvers([maneuver]);
    lastEstimateAt = 0;
  }
  if (now - lastEstimateAt > 1000) {
    lastEstimateAt = now;
    map.updateTravelEstimates(0, { distanceRemaining: Math.round(g.distanceToNextM), timeRemaining: Math.round(g.distanceToNextM / 12), distanceUnits: "meters" });
    map.updateTravelEstimatesForTrip(navTrip, { distanceRemaining: Math.round(g.remainingM / 100) / 10, timeRemaining: Math.round(g.remainingS), distanceUnits: "kilometers" });
  }

  // A confirmed driver report ahead: ask "still there?" once (the answer is the usual vote).
  if (ahead && ahead.item.source === "community" && !askedReports.has(ahead.item.id) && ahead.distanceM < 500) {
    askedReports.add(ahead.item.id);
    const id = alertSeq++;
    alertReport.set(id, ahead.item.id);
    const c = T().car;
    const what = T().reports.categories[ahead.item.category];
    map.presentNavigationAlert({
      titleVariants: [`${fmt(c.ahead, { what })} · ${fmtDistance(ahead.distanceM, ctx())}`],
      subtitleVariants: [c.stillThere],
      primaryAction: { title: c.yes },
      secondaryAction: { title: c.no, style: NavigationAlertActionStyle.Cancel },
      duration: 20,
      navigationAlertId: id,
      lightImage: MARKER[ahead.item.category],
      darkImage: MARKER[ahead.item.category],
    });
  }
}

// ---------------------------------------------------------------- search and destinations
function planTo(p: Place) {
  CarPlay.popToRootTemplate(true);
  carBridge.actions()?.planTo(p);
}

function openSearch() {
  const c = T().car;
  let results: Place[] = [];
  const search = new SearchTemplate({
    searchHint: c.searchHint,
    async onSearch(query: string): Promise<ListItem[]> {
      const q = query.trim();
      if (q.length < 2) return [];
      try {
        const r = await api.search(q, lang(), carBridge.live().fix?.coord ?? undefined, { remote: true, autocomplete: false });
        results = r.results.slice(0, 12);
        return results.map((p) => ({ text: p.name, detailText: p.secondary ?? "" }));
      } catch {
        results = [];
        return [{ text: c.failed }];
      }
    },
    async onItemSelect({ index }) {
      const p = results[index];
      if (p) planTo(p);
    },
  });
  CarPlay.pushTemplate(search, true);
}

function openDestinations() {
  const c = T().car;
  const s = getState();
  const t = T();
  const saved: Place[] = [
    ...(s.saved.home ? [{ ...s.saved.home, name: t.saved.home }] : []),
    ...(s.saved.work ? [{ ...s.saved.work, name: t.saved.work }] : []),
    ...s.saved.favorites,
  ];
  const recent = s.recents.filter((r) => !saved.some((x) => x.id === r.id)).slice(0, 10);
  const all = [...saved, ...recent];
  const item = (p: Place): ListItem => ({ text: p.name, detailText: p.secondary ?? "", showsDisclosureIndicator: true });
  const list = new ListTemplate({
    title: c.destinations,
    sections: [
      ...(saved.length ? [{ header: c.saved, items: saved.map(item) }] : []),
      ...(recent.length ? [{ header: c.recent, items: recent.map(item) }] : []),
    ],
    emptyViewTitleVariants: [c.noPlaces],
    async onItemSelect({ index }) {
      const p = all[index];
      if (p) planTo(p);
    },
  });
  CarPlay.pushTemplate(list, true);
}

// ---------------------------------------------------------------- one-tap reports
function openReport() {
  const t = T();
  const grid = new GridTemplate({
    title: t.car.report,
    buttons: REPORT_GRID.map((cat) => ({ id: cat, titleVariants: [t.reports.categories[cat]], image: MARKER[cat]! })),
    onButtonPressed: ({ id }) => {
      CarPlay.popTemplate(true);
      const { fix, demo } = carBridge.live();
      // Simulated drives never send public reports (same rule as the phone).
      if (!fix || demo) return;
      const heading = fix.headingDeg != null && fix.headingDeg >= 0 ? fix.headingDeg : undefined;
      void api.createReport(id as ReportCategory, fix.coord, heading)
        .then((r) => { mergeReports([r.report]); notify(t.car.thanks); })
        .catch(() => notify(t.car.failed));
    },
  });
  CarPlay.pushTemplate(grid, true);
}

function notify(text: string) {
  map?.presentNavigationAlert({
    titleVariants: [text],
    primaryAction: { title: T().common.ok },
    duration: 4,
    navigationAlertId: alertSeq++,
  });
}
