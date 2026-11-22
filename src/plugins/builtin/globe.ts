// Globe (0.21): live questions about the planet, inspired by God's Eye View and adapted for Lotus.
//
// God's Eye View (https://github.com/bilawalsidhu/gods-eye-view, MIT, Copyright (c) 2026 Bilawal Sidhu)
// is a 3D globe app with an MCP server. Its MIT licence covers its code; the data it shows belongs to
// each provider. Lotus does not bundle the app or any of its data. This plugin adapts the ideas of its
// tool playbook and MCP instructions (ask by area, check capped results, show what is live, never
// track people) for small local models, in two ways:
//   1. With God's Eye View running and added as a tool server, Lotus uses its tools (mcp.gev_…).
//   2. Without it, Lotus reads the same kind of free, keyless public feeds with web.read
//      (which opens JSON and CSV since 0.21) and can draw the results as a simple SVG map.
// "God's Eye View" is a trademark of Metaversity LLC, so the plugin has its own name and only
// mentions the app to say it works with it.

import type { BuiltinPluginDef } from './types';

export const GLOBE: BuiltinPluginDef = {
  id: 'builtin-globe',
  name: 'Globe',
  version: '1.0.0',
  description: 'Ask what is happening on Earth right now: earthquakes, planes, the ISS, launches, fires and storms, from free public data. Works with God’s Eye View.',
  author: 'Lotus, inspired by Bilawal Sidhu’s God’s Eye View',
  defaultOn: true,
  credit: {
    by: 'Bilawal Sidhu (bilawalsidhu/gods-eye-view)', license: 'MIT', url: 'https://github.com/bilawalsidhu/gods-eye-view',
    note: 'Adapted from God’s Eye View’s tool playbook for small local models. Lotus does not include the app or its data; it can connect to it. MIT licence, Copyright (c) 2026 Bilawal Sidhu.',
  },
  instructions: '',
  commands: [
    { name: 'globe', description: 'Ask what is happening somewhere on Earth now', prompt: 'Answer this from live public data (use the live-world skill: God’s Eye View tools if connected, otherwise the open feeds with web.read). Give numbers, places, times and sources, and say how fresh the data is:\n\n{{input}}' },
    { name: 'globe-map', description: 'Put places from the answer on a map', prompt: 'Draw these places on a simple map as an SVG artifact, following the globe-map skill. Label each point and add the source and time:\n\n{{input}}' },
  ],
  skills: [
    {
      name: 'live-world',
      description: 'Answer what is happening on Earth now: earthquakes, planes, satellites, launches, fires, storms.',
      whenToUse: 'Live questions about the planet right now: an earthquake or quake, planes or flights overhead, military aircraft, the ISS or a satellite pass, a rocket launch, wildfires, hurricanes, cyclones, volcanoes, or what is happening on the globe near a place.',
      anchors: ['earthquake', 'quake', 'wildfire', 'hurricane', 'cyclone', 'typhoon', 'volcano', 'iss', 'rocket launch', 'satellite pass', 'planes overhead', 'flights overhead', 'eye view', 'globe'],
      body: `# Live world questions

1. If there are tools named mcp.gev_… (God's Eye View connected), use them first. They take an area: a place name, or lat/lon with radius_km. Results are capped: check truncated and total before saying there is nothing more.
2. Otherwise open these free feeds with web.read (no key). Get a place's lat/lon first:
https://geocoding-api.open-meteo.com/v1/search?name=PLACE&count=1
- Earthquakes: https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&orderby=time&limit=10&minmagnitude=2.5&latitude=LAT&longitude=LON&maxradiuskm=500 (leave out lat, lon and radius for the world)
- Planes near a point (dist in nautical miles, up to 250): https://api.adsb.lol/v2/lat/LAT/lon/LON/dist/25 · military: https://api.adsb.lol/v2/mil
- ISS now: https://api.wheretheiss.at/v1/satellites/25544
- A satellite's orbit: https://celestrak.org/NORAD/elements/gp.php?CATNR=NORAD_ID&FORMAT=json
- Launches: https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=5&mode=list
- Wildfires, storms, volcanoes: https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=20&category=wildfires (or severeStorms, volcanoes)
- Hurricanes: https://www.nhc.noaa.gov/CurrentStorms.json
- Conditions at a point: https://api.open-meteo.com/v1/forecast?latitude=LAT&longitude=LON&current=temperature_2m,wind_speed_10m,precipitation
3. Answer from the numbers you got: what, where, when (feeds use UTC; give local time too) and the source. Say how old the data is. If a feed fails, say so. Never make up positions or counts.
4. Live ships need an AISStream key and NASA FIRMS fires a free NASA key: say God's Eye View shows them once those keys are added there.
5. Several places? Offer a map (globe-map skill).

Rules: places and things, never people. Do not help find or follow a person. Data can be late or wrong, so never use it for navigation or safety decisions.`,
    },
    {
      name: 'globe-map',
      description: 'Draw places, quakes, planes or events on a simple world or region map as an SVG.',
      whenToUse: 'Put places, coordinates, earthquakes, flights, fires or events on a map, plot points by latitude and longitude, or draw a world or region map of results.',
      anchors: ['map of', 'on a map', 'plot coordinates'],
      body: `# Map of places

A grid map drawn as SVG: no internet and no map key needed. It has no coastlines, so label every point well.

1. List each item: label, lat, lon, and a value if there is one (magnitude, altitude…).
2. Frame: the world is west -180, east 180, south -90, north 90. For a region, use the items' smallest and largest lat/lon plus a 10% margin.
3. Size: width 1000, height = 1000 × (north − south) / (east − west).
4. Position of each point:
   x = (lon − west) / (east − west) × width
   y = (north − lat) / (north − south) × height
5. Draw, in this order: a dark blue background rect; thin grey grid lines every 30° (10° for a region) with degree labels; one circle per item (radius 4, or 3 + value × 2 for magnitudes) in orange; its label in small white text just right of it; a title at the top; source and time (UTC) at the bottom.
6. Save it with artifact.write as map.svg (Work mode). In chat, give a table instead: label, lat, lon, value.
7. For each important point add an OpenStreetMap link: https://www.openstreetmap.org/?mlat=LAT&mlon=LON#map=8/LAT/LON
8. If God's Eye View is connected (tools mcp.gev_…), its show_in_gods_eye_view tool gives a link to the same view on its 3D globe: add it.`,
    },
    {
      name: 'connect-gods-eye-view',
      description: 'Set up God’s Eye View, the free 3D globe app, and connect it to Lotus as a tool server.',
      whenToUse: 'Install, set up or connect God’s Eye View (gods-eye-view) to Lotus, its MCP tool server, its 3D globe, or its keys.',
      anchors: ['eye view setup', 'connect eye view', 'install eye view', 'gods eye view'],
      body: `# Connect God's Eye View

God's Eye View is a free, open-source 3D globe app (by Bilawal Sidhu, MIT licence) with live flights, ships, satellites, weather and public cameras. Lotus can use its tools while it runs on this PC.

1. Install it, either:
   - One click: install Pinokio (pinokio.co, version 8.2 or later), find God's Eye View, press Install, then Start.
   - Or with Node.js 24: git clone https://github.com/bilawalsidhu/gods-eye-view, then npm ci and npm run dev.
2. Note the address it opens, usually http://localhost:4173 (Pinokio may pick another port).
3. In Lotus: Settings → Advanced (turn on Advanced mode under General if it is hidden) → Tool servers (MCP) → add a server. Kind: Web address. Name: gev. Address: http://localhost:4173/mcp (with its port).
4. Wait until it says ready and lists its tools. Lotus asks before each use.
5. Keys are optional and go in God's Eye View's own POWER UP panel, not in Lotus: Cesium ion or Google Maps for photo-real 3D, AISStream for ships, NASA FIRMS for fires. Its voice needs an OpenAI or Gemini key, but Lotus does not: Lotus does the talking.
6. Keep God's Eye View open while Lotus uses it. Its answers can carry a link that opens the view in the browser.

Its data comes from each provider under their own terms; some (Google Maps, OpenSky, the submarine cable map) do not allow commercial use.`,
    },
  ],
};
