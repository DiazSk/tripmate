/**
 * Places to mark on `DestinationMap`'s field — the well-known destinations a traveller would name
 * unprompted, on every inhabited continent.
 *
 * **Why a long list is not the twelve pins this beat was rebuilt to remove.** The old map drew
 * exactly twelve dots, four of them flagged `featured`, all four in the accent colour. Twelve is a
 * *countable set*, and a countable set of pins under the heading "Anywhere you can name" reads as
 * "we support these twelve" — the precise opposite of the claim. The failure was never the density;
 * it was that the density was low enough to be read as an inventory, and that the marks wore the
 * colour reserved for things that act.
 *
 * These are the other direction. There are enough of them, spread widely enough, that no visitor
 * counts them — the eye reads "the world is full of places", which is the claim. And they are
 * deliberately inert: one neutral slate at an alpha, identical radius, no labels, no hover, no
 * `aria`. **Nothing here is tiered.** A "major" subset drawn larger would be `featured: true`
 * coming back under a new name, and the four things on this map that genuinely differ are the four
 * shipped plans, which differ by *being controls* rather than by being bigger.
 *
 * So this list is allowed to be incomplete, and it is: it is a legible scatter, not a gazetteer.
 * Adding or dropping one changes nothing about what the map asserts, which is the test for whether
 * an entry belongs. What it must keep is the **spread** — every continent, both hemispheres, and no
 * empty ocean quadrant where a landmass has marks in the reference frame. Cluster them into Europe
 * and the map argues the opposite thing quietly.
 *
 * Coordinates are town centres in degrees, read only through `projectToMap()`. One degree is under
 * four pixels on the 1200-unit world, so nothing here needs to be better than a city block, and two
 * places within a degree of each other (Cusco and Machu Picchu, say) would land on the same mark —
 * hence one of each such pair.
 *
 * **Four of these sit in open water on purpose, so nobody "fixes" them.** `WORLD_LAND_PATH` is
 * Natural Earth 110m, which is too coarse to carry an island smaller than roughly a degree —
 * measured with `SVGGeometryElement.isPointInFill()` against the rendered path, Santorini, Malé,
 * the Galápagos and Bora Bora all land off it, and so does Havana, Cuba being about three user
 * units tall at this scale. They stay. A travel map that drops French Polynesia and the Maldives to
 * satisfy a coastline dataset has the priority backwards, and an unlabelled mark in the Pacific
 * reads as an island, which is what it is. If that ever needs to stop being true, the fix is a
 * finer land path, not a shorter list.
 *
 * The name is for whoever edits this file, not for the page. Nothing renders it; it is what makes a
 * stray coordinate findable when a mark shows up in the sea.
 */
export const MAP_PLACES: readonly (readonly [name: string, lat: number, lon: number])[] = [
  // Europe
  ["Paris", 48.86, 2.35],
  ["London", 51.51, -0.13],
  ["Rome", 41.9, 12.5],
  ["Barcelona", 41.39, 2.17],
  ["Amsterdam", 52.37, 4.9],
  ["Venice", 45.44, 12.33],
  ["Prague", 50.09, 14.42],
  ["Vienna", 48.21, 16.37],
  ["Berlin", 52.52, 13.4],
  ["Copenhagen", 55.68, 12.57],
  ["Edinburgh", 55.95, -3.19],
  ["Lisbon", 38.72, -9.14],
  ["Santorini", 36.39, 25.46],
  ["Dubrovnik", 42.65, 18.09],
  ["Istanbul", 41.01, 28.98],
  ["Zermatt", 46.02, 7.75],
  ["Reykjavík", 64.15, -21.94],
  ["Tromsø", 69.65, 18.96],
  ["St Petersburg", 59.94, 30.31],
  ["Moscow", 55.76, 37.62],

  // Asia and the Middle East
  ["Tokyo", 35.68, 139.69],
  ["Kyoto", 35.01, 135.77],
  ["Seoul", 37.57, 126.98],
  ["Beijing", 39.9, 116.41],
  ["Shanghai", 31.23, 121.47],
  ["Hong Kong", 22.32, 114.17],
  ["Taipei", 25.03, 121.57],
  ["Bangkok", 13.76, 100.5],
  ["Singapore", 1.35, 103.82],
  ["Ubud", -8.51, 115.26],
  ["Hanoi", 21.03, 105.85],
  ["Siem Reap", 13.36, 103.86],
  ["Luang Prabang", 19.89, 102.14],
  ["Kathmandu", 27.72, 85.32],
  ["Agra", 27.18, 78.02],
  ["Mumbai", 19.08, 72.88],
  ["Colombo", 6.93, 79.86],
  ["Malé", 4.18, 73.51],
  ["Dubai", 25.2, 55.27],
  ["Jerusalem", 31.78, 35.22],
  ["Samarkand", 39.65, 66.98],
  ["Almaty", 43.24, 76.89],
  ["Ulaanbaatar", 47.89, 106.91],
  ["Manila", 14.6, 120.98],

  // Africa
  ["Cairo", 30.04, 31.24],
  ["Luxor", 25.69, 32.64],
  ["Marrakesh", 31.63, -7.99],
  ["Fez", 34.03, -5.0],
  ["Dakar", 14.72, -17.47],
  ["Accra", 5.6, -0.19],
  ["Addis Ababa", 9.03, 38.74],
  ["Nairobi", -1.29, 36.82],
  ["Serengeti", -2.33, 34.83],
  ["Zanzibar", -6.16, 39.2],
  ["Victoria Falls", -17.92, 25.86],
  ["Windhoek", -22.56, 17.08],
  ["Cape Town", -33.92, 18.42],
  ["Antananarivo", -18.88, 47.51],

  // North America and the Caribbean
  ["New York", 40.71, -74.01],
  ["Quebec City", 46.81, -71.21],
  ["Chicago", 41.88, -87.63],
  ["New Orleans", 29.95, -90.07],
  ["Miami", 25.76, -80.19],
  ["Las Vegas", 36.17, -115.14],
  ["Grand Canyon", 36.06, -112.14],
  ["San Francisco", 37.77, -122.42],
  ["Vancouver", 49.28, -123.12],
  ["Banff", 51.18, -115.57],
  ["Anchorage", 61.22, -149.9],
  ["Mexico City", 19.43, -99.13],
  ["Tulum", 20.21, -87.47],
  ["Havana", 23.11, -82.37],
  ["San Juan", 18.47, -66.11],

  // South America
  ["Cartagena", 10.39, -75.51],
  ["Quito", -0.18, -78.47],
  ["Galápagos", -0.74, -90.31],
  ["Cusco", -13.53, -71.97],
  ["La Paz", -16.5, -68.15],
  ["Rio de Janeiro", -22.91, -43.17],
  ["Iguazú", -25.69, -54.44],
  ["Santiago", -33.45, -70.67],
  ["Buenos Aires", -34.6, -58.38],
  ["Torres del Paine", -50.94, -73.41],

  // Oceania
  ["Cairns", -16.92, 145.77],
  ["Sydney", -33.87, 151.21],
  ["Melbourne", -37.81, 144.96],
  ["Perth", -31.95, 115.86],
  ["Auckland", -36.85, 174.76],
  ["Queenstown", -45.03, 168.66],
  ["Bora Bora", -16.5, -151.74],
  ["Nadi", -17.78, 177.42],
];
