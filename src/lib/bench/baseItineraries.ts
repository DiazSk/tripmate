import type { Itinerary } from "../types";

/**
 * The frozen plan each refine cell starts from, one per fixture.
 *
 * Minted once by scripts/mint-base-itineraries.mjs on the production model and committed verbatim.
 * Re-minting invalidates every stored refine result, because the delta a cell reports is measured
 * against these exact bytes.
 */
export const BASE_ITINERARIES: Record<string, Itinerary> = {
  "barcelona-access-dietary": {
    "tier": "midrange",
    "days": [
      {
        "date": "2026-10-15",
        "weather": "No weather data available",
        "summary": "Arrive in Barcelona and ease into the city with Art Nouveau splendor and an evening stroll through medieval lanes. 🏛️✨",
        "lodging": {
          "name": "Hotel Ronda Sant Pere",
          "cost": 230,
          "note": "Boutique hotel in Eixample; central location near Gothic Quarter suits culture-focused couple with mobility needs"
        },
        "stops": [
          {
            "name": "Private transfer from Barcelona-El Prat Airport",
            "lat": 41.2974,
            "lng": 2.0833,
            "cost": 90,
            "why": "Door-to-door comfort after international flight, no stairs or metro transfers",
            "note": "Pre-book for arrival; 30-min drive to hotel depending on traffic",
            "time": "3:00 PM",
            "durationLabel": "45 minutes",
            "tags": [
              "Transit"
            ],
            "category": "transit"
          },
          {
            "name": "Palau de la Música Catalana",
            "lat": 41.3875,
            "lng": 2.1754,
            "cost": 35,
            "why": "Art Nouveau masterpiece close to hotel, elevator access, deep cultural history",
            "note": "Book 4:30pm guided tour online; concert hall mosaics are photo-worthy",
            "time": "4:30 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Must-See",
              "Reservation Needed"
            ],
            "category": "entry"
          },
          {
            "name": "Gothic Quarter walk",
            "lat": 41.3833,
            "lng": 2.1769,
            "cost": 0,
            "why": "Layered Roman and medieval history on mostly flat lanes, core culture stop",
            "note": "5-min walk from Palau; focus on Plaça del Rei and Cathedral exterior",
            "time": "6:00 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Free",
              "Local Pick"
            ],
            "category": "other"
          },
          {
            "name": "Dinner in El Born",
            "lat": 41.3851,
            "lng": 2.1833,
            "cost": 140,
            "why": "Historic quarter with strong vegan dining scene, easy walk from hotel",
            "note": "Flax & Kale (all vegan, nut-free on request); order veggie bowl or pizza",
            "time": "7:30 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Port Vell evening stroll",
            "lat": 41.3764,
            "lng": 2.1833,
            "cost": 20,
            "why": "Flat waterfront walk, romantic evening atmosphere for couple",
            "note": "Short taxi to marina; 20-min stroll then taxi back to hotel",
            "time": "9:30 PM",
            "durationLabel": "45 minutes",
            "tags": [
              "Free"
            ],
            "category": "other"
          }
        ]
      },
      {
        "date": "2026-10-16",
        "weather": "No weather data available",
        "summary": "Dive deep into Catalan culture with Picasso's Blue Period, Gothic stone, and lively market flavors. 🎨🏰",
        "lodging": {
          "name": "Hotel Ronda Sant Pere",
          "cost": 230,
          "note": "Same central base; no check-in/out time wasted, perfect for full sightseeing day"
        },
        "stops": [
          {
            "name": "Picasso Museum",
            "lat": 41.3851,
            "lng": 2.1803,
            "cost": 35,
            "why": "World's finest Picasso collection, elevator throughout, culture priority met",
            "note": "Book 9:30am timed entry online; Blue Period rooms are the highlight",
            "time": "9:30 AM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Must-See",
              "Reservation Needed"
            ],
            "category": "entry"
          },
          {
            "name": "Santa Caterina Market",
            "lat": 41.3856,
            "lng": 2.175,
            "cost": 30,
            "why": "Gaudí-designed roof, food culture focus, vendor interaction and photography",
            "note": "5-min walk from museum; buy fresh fruit and vegan snacks to try",
            "time": "11:15 AM",
            "durationLabel": "1 hour",
            "tags": [
              "Local Pick",
              "Food"
            ],
            "category": "other"
          },
          {
            "name": "Taxi to El Born",
            "lat": 41.3847,
            "lng": 2.1828,
            "cost": 18,
            "why": "Avoid 15-min walk with bags from market, keeps energy for afternoon",
            "note": "Quick ride across neighborhood",
            "time": "12:20 PM",
            "durationLabel": "10 minutes",
            "tags": [
              "Transit"
            ],
            "category": "transit"
          },
          {
            "name": "Lunch around El Born",
            "lat": 41.3847,
            "lng": 2.1828,
            "cost": 130,
            "why": "Vegan-forward Catalan cuisine, sit-down midday rest, food priority",
            "note": "Teresa Carles for Catalan-vegan fusion; order vegetable paella (nut-free)",
            "time": "12:30 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Barcelona Cathedral & Cloister",
            "lat": 41.384,
            "lng": 2.1761,
            "cost": 20,
            "why": "Gothic architecture centerpiece, elevator to roof, deep medieval history",
            "note": "8-min walk from lunch; elevator access to terrace for panoramic views",
            "time": "2:30 PM",
            "durationLabel": "1 hour 15 minutes",
            "tags": [
              "Must-See"
            ],
            "category": "entry"
          },
          {
            "name": "Coffee break & rest",
            "lat": 41.3829,
            "lng": 2.1744,
            "cost": 18,
            "why": "Essential sit-down break for mobility pacing, energizes for evening",
            "note": "Satan's Coffee Corner nearby; vegan milk available, request no nuts",
            "time": "4:00 PM",
            "durationLabel": "45 minutes",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Jewish Quarter & Plaça del Rei",
            "lat": 41.3836,
            "lng": 2.1769,
            "cost": 0,
            "why": "Roman-medieval layers, atmospheric narrow lanes, culture and history depth",
            "note": "Adjacent to Cathedral; Plaça del Rei shows preserved Roman walls",
            "time": "5:15 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Free",
              "Must-See"
            ],
            "category": "other"
          },
          {
            "name": "Taxi to Raval",
            "lat": 41.3794,
            "lng": 2.1686,
            "cost": 15,
            "why": "Avoids 20-min walk after full sightseeing day, preserves evening energy",
            "note": "10-min ride across old town",
            "time": "7:00 PM",
            "durationLabel": "10 minutes",
            "tags": [
              "Transit"
            ],
            "category": "transit"
          },
          {
            "name": "Dinner in Raval",
            "lat": 41.3794,
            "lng": 2.1686,
            "cost": 145,
            "why": "Bohemian neighborhood with diverse vegan scene, international food focus",
            "note": "Vegetalia (fully vegan); try seitan dishes or chickpea burgers",
            "time": "7:15 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          }
        ]
      },
      {
        "date": "2026-10-17",
        "weather": "No weather data available",
        "summary": "Stand beneath Sagrada Família's soaring columns, then stroll Modernisme and shop the elegant Passeig. 🏛️🛍️",
        "lodging": {
          "name": "Hotel Ronda Sant Pere",
          "cost": 230,
          "note": "Final night in same base; maximizes sightseeing time, no packing/moving hassle"
        },
        "stops": [
          {
            "name": "Sagrada Família",
            "lat": 41.4036,
            "lng": 2.1744,
            "cost": 45,
            "why": "Barcelona's icon, elevator to towers avoids stairs, unmissable architecture",
            "note": "Book 9am entry online; elevator to Passion facade tower for views",
            "time": "9:00 AM",
            "durationLabel": "2 hours",
            "tags": [
              "Must-See",
              "Reservation Needed"
            ],
            "category": "entry"
          },
          {
            "name": "Taxi to Sant Pau",
            "lat": 41.4143,
            "lng": 2.1755,
            "cost": 22,
            "why": "Avoids 15-min uphill walk, preserves energy for site exploration",
            "note": "5-min ride northeast",
            "time": "11:15 AM",
            "durationLabel": "10 minutes",
            "tags": [
              "Transit"
            ],
            "category": "transit"
          },
          {
            "name": "Sant Pau Art Nouveau Site",
            "lat": 41.4143,
            "lng": 2.1755,
            "cost": 25,
            "why": "Modernist hospital campus, flat landscaped grounds, fewer crowds than Gaudí",
            "note": "Peaceful gardens included; underground tunnels connect pavilions",
            "time": "11:30 AM",
            "durationLabel": "1 hour",
            "tags": [
              "Local Pick"
            ],
            "category": "entry"
          },
          {
            "name": "Taxi to Gràcia",
            "lat": 41.4028,
            "lng": 2.1581,
            "cost": 20,
            "why": "Bypasses 20-min walk, arrives fresh for lunch in local neighborhood",
            "note": "10-min ride southwest to Vila de Gràcia",
            "time": "12:40 PM",
            "durationLabel": "10 minutes",
            "tags": [
              "Transit"
            ],
            "category": "transit"
          },
          {
            "name": "Lunch in Gràcia",
            "lat": 41.4028,
            "lng": 2.1581,
            "cost": 135,
            "why": "Authentic local neighborhood away from tourists, strong vegan culture",
            "note": "Aguaribay (organic vegan); order Buddha bowls or mushroom risotto",
            "time": "12:45 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Passeig de Gràcia architecture walk",
            "lat": 41.3948,
            "lng": 2.1638,
            "cost": 0,
            "why": "Casa Batlló, Casa Milà and Modernisme gems on flat boulevard, culture focus",
            "note": "Taxi from Gràcia; admire exteriors from sidewalk for free photos",
            "time": "2:45 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Free",
              "Must-See"
            ],
            "category": "other"
          },
          {
            "name": "Shopping on Passeig de Gràcia",
            "lat": 41.3931,
            "lng": 2.1622,
            "cost": 500,
            "why": "Premier shopping district per brief, mix of luxury and local boutiques",
            "note": "Same street as architecture walk; El Corte Inglés for variety",
            "time": "4:30 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Shopping"
            ],
            "category": "other"
          },
          {
            "name": "Taxi to Eixample dinner",
            "lat": 41.39,
            "lng": 2.1686,
            "cost": 20,
            "why": "Short ride to upscale dining district, avoids bags from shopping walk",
            "note": "5-min ride within same neighborhood",
            "time": "6:15 PM",
            "durationLabel": "10 minutes",
            "tags": [
              "Transit"
            ],
            "category": "transit"
          },
          {
            "name": "Dinner in Eixample",
            "lat": 41.39,
            "lng": 2.1686,
            "cost": 155,
            "why": "Upscale modern Catalan dining, near hotel for easy return, food priority",
            "note": "CatBar (vegan tasting menu available); confirm nut-free preparation",
            "time": "6:45 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Reservation Needed"
            ],
            "category": "food"
          },
          {
            "name": "Magic Fountain of Montjuïc",
            "lat": 41.3711,
            "lng": 2.1514,
            "cost": 25,
            "why": "Evening light-and-water spectacle, photography opportunity, sit-down viewing",
            "note": "Taxi each way; Fri/Sat shows in Oct; view from lower terrace (no stairs)",
            "time": "9:00 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Free",
              "Local Pick"
            ],
            "category": "other"
          }
        ]
      },
      {
        "date": "2026-10-18",
        "weather": "No weather data available",
        "summary": "A final taste of Barcelona's market energy before heading home. 🍇🛫",
        "stops": [
          {
            "name": "La Boqueria Market breakfast",
            "lat": 41.3816,
            "lng": 2.1719,
            "cost": 40,
            "why": "Iconic food market, final cultural immersion, fresh vegan options everywhere",
            "note": "Pinotxo Bar has grilled vegetables; fresh fruit stalls for breakfast",
            "time": "8:00 AM",
            "durationLabel": "1 hour 15 minutes",
            "tags": [
              "Must-See",
              "Food"
            ],
            "category": "food"
          },
          {
            "name": "Private transfer to Barcelona-El Prat Airport",
            "lat": 41.2974,
            "lng": 2.0833,
            "cost": 90,
            "why": "Stress-free departure with luggage, no metro stairs or connections",
            "note": "Pre-booked pickup at 9:30am from hotel for 11am flight",
            "time": "9:30 AM",
            "durationLabel": "45 minutes",
            "tags": [
              "Transit"
            ],
            "category": "transit"
          }
        ]
      }
    ]
  },

  "kyoto-couple-mixed": {
    "tier": "midrange",
    "days": [
      {
        "date": "2026-09-19",
        "weather": "No weather data available",
        "summary": "Begin in southern Kyoto with an early-morning hike through vermillion torii gates, followed by sake tasting and serene temple gardens before a refined kaiseki dinner. ⛩️🍶",
        "lodging": {
          "name": "Boutique ryokan-style hotel in Higashiyama",
          "cost": 240,
          "note": "Traditional tatami-modern fusion suits culture focus; taxi-friendly to sights. Alt: standard business hotel ~$120/night."
        },
        "stops": [
          {
            "name": "Taxi from Kyoto Station to hotel",
            "lat": 34.9858,
            "lng": 135.7581,
            "cost": 35,
            "why": "Direct arrival transfer to boutique lodging base",
            "note": "20-minute ride; drop bags and head straight out",
            "time": "8:00 AM",
            "durationLabel": "20 minutes",
            "category": "transit",
            "tags": [
              "Arrival"
            ]
          },
          {
            "name": "Fushimi Inari Taisha",
            "lat": 34.9671,
            "lng": 135.7727,
            "cost": 0,
            "why": "Iconic torii paths visited at 8:30 AM to beat tour buses",
            "note": "Hike partway up the mountain; descent by 10:30 before crowds peak",
            "time": "8:30 AM",
            "durationLabel": "2 hours",
            "category": "other",
            "tags": [
              "Free",
              "Must-See"
            ]
          },
          {
            "name": "Gekkeikan Okura Sake Museum",
            "lat": 34.9276,
            "lng": 135.7642,
            "cost": 15,
            "why": "Fushimi's brewing heritage; intimate museum with tasting",
            "note": "10-minute taxi from Inari; includes sake cup souvenir",
            "time": "11:00 AM",
            "durationLabel": "1 hour",
            "category": "entry",
            "tags": [
              "Local Pick",
              "Tasting"
            ]
          },
          {
            "name": "Lunch in Fushimi sake district",
            "lat": 34.9276,
            "lng": 135.7642,
            "cost": 35,
            "why": "Breweries line the canal; tofu-skin shops and soba nearby",
            "note": "Try Torisei for yakitori, or kyo-ryori teishoku at a brewery restaurant",
            "time": "12:15 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Local Pick"
            ]
          },
          {
            "name": "Tofuku-ji Temple",
            "lat": 34.9767,
            "lng": 135.7733,
            "cost": 5,
            "why": "Zen garden and covered bridge; quieter than Kiyomizu in afternoon",
            "note": "Taxi 15 min from Fushimi; famous for autumn but serene now",
            "time": "2:00 PM",
            "durationLabel": "1.5 hours",
            "category": "entry",
            "tags": [
              "Culture & History"
            ]
          },
          {
            "name": "Taxi to Pontocho",
            "lat": 35.0047,
            "lng": 135.7706,
            "cost": 20,
            "why": "Transfer to dining district along the Kamo River",
            "note": "15-minute ride from Tofuku-ji to central Kyoto",
            "time": "4:00 PM",
            "durationLabel": "15 minutes",
            "category": "transit",
            "tags": [
              "Transfer"
            ]
          },
          {
            "name": "Coffee and rest in Pontocho",
            "lat": 35.0047,
            "lng": 135.7706,
            "cost": 12,
            "why": "Recharge before dinner; riverside terrace seating in early evening",
            "note": "Many cafes with Kamo-gawa views; arrive before dinner rush",
            "time": "4:30 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "River View"
            ]
          },
          {
            "name": "Kaiseki dinner in Pontocho alley",
            "lat": 35.0047,
            "lng": 135.7706,
            "cost": 145,
            "why": "Seasonal Kyoto haute cuisine in atmospheric narrow alley",
            "note": "Reserve ahead; riverside seats book first; try Pontocho Misoguigawa or similar",
            "time": "7:00 PM",
            "durationLabel": "2 hours",
            "category": "food",
            "tags": [
              "Reservation Needed",
              "Fine Dining"
            ]
          }
        ]
      },
      {
        "date": "2026-09-20",
        "weather": "No weather data available",
        "summary": "A tranquil walk along the Philosopher's Path through hidden temples, then dive into Nishiki Market's culinary treasures before an intimate tea ceremony and Gion dining. 🍵🎎",
        "lodging": {
          "name": "Boutique ryokan-style hotel in Higashiyama",
          "cost": 240,
          "note": "Same base; walkable to Gion nightlife and morning transit routes. Alt: guesthouse ~$80/night."
        },
        "stops": [
          {
            "name": "Taxi to northern Philosopher's Path",
            "lat": 35.0262,
            "lng": 135.7942,
            "cost": 25,
            "why": "Direct morning transfer to quiet canal-side walk",
            "note": "Start at Ginkaku-ji end and walk south; 20-minute ride",
            "time": "8:30 AM",
            "durationLabel": "20 minutes",
            "category": "transit",
            "tags": [
              "Transfer"
            ]
          },
          {
            "name": "Philosopher's Path and Honen-in Temple",
            "lat": 35.0262,
            "lng": 135.7942,
            "cost": 0,
            "why": "Cherry-tree canal stroll to moss-garden temple; hardly any tourists",
            "note": "Walk 1.5 km south from Ginkaku-ji; Honen-in is tucked in hillside",
            "time": "9:00 AM",
            "durationLabel": "2 hours",
            "category": "other",
            "tags": [
              "Free",
              "Hidden Gem"
            ]
          },
          {
            "name": "Lunch near Ginkaku-ji area",
            "lat": 35.027,
            "lng": 135.7983,
            "cost": 40,
            "why": "Neighborhood teahouses and soba shops; quieter than downtown",
            "note": "Try Omen for thick udon, or Ginkaku-ji Kissa for simple lunch sets",
            "time": "12:00 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Local Pick"
            ]
          },
          {
            "name": "Taxi to Nishiki Market",
            "lat": 35.005,
            "lng": 135.765,
            "cost": 20,
            "why": "Transfer to central covered food market",
            "note": "15-minute ride from Ginkaku-ji to market entrance",
            "time": "1:30 PM",
            "durationLabel": "15 minutes",
            "category": "transit",
            "tags": [
              "Transfer"
            ]
          },
          {
            "name": "Nishiki Market",
            "lat": 35.005,
            "lng": 135.765,
            "cost": 100,
            "why": "Kyoto's 400-year kitchen; pickles, knives, matcha sweets for food lovers",
            "note": "Covered arcade stays cool; buy tsukemono, yuba, tea; tastings everywhere",
            "time": "2:00 PM",
            "durationLabel": "2 hours",
            "category": "other",
            "tags": [
              "Shopping",
              "Must-See"
            ]
          },
          {
            "name": "Traditional tea ceremony experience",
            "lat": 35.0116,
            "lng": 135.7681,
            "cost": 140,
            "why": "Intimate chado ritual suits culture priority; semi-private session",
            "note": "Book via En or Camellia; near Gion; includes wagashi sweets",
            "time": "4:30 PM",
            "durationLabel": "1.5 hours",
            "category": "other",
            "tags": [
              "Reservation Needed",
              "Cultural Experience"
            ]
          },
          {
            "name": "Dinner in Gion district",
            "lat": 35.0033,
            "lng": 135.7751,
            "cost": 100,
            "why": "Geisha quarter dining; izakaya or kyo-kaiseki in historic machiya",
            "note": "Walk from tea venue; avoid touristy spots on Shijo; try side streets",
            "time": "7:00 PM",
            "durationLabel": "1.5 hours",
            "category": "food",
            "tags": [
              "Atmosphere"
            ]
          }
        ]
      },
      {
        "date": "2026-09-21",
        "weather": "No weather data available",
        "summary": "Venture west to Arashiyama's bamboo groves and mountain villa gardens, then return to the city for a final evening of refined dining and reflection. 🎋🏞️",
        "lodging": {
          "name": "Boutique ryokan-style hotel in Higashiyama",
          "cost": 240,
          "note": "Same familiar base; last night before checkout tomorrow. Alt: Arashiyama inn ~$200/night."
        },
        "stops": [
          {
            "name": "Taxi to Arashiyama",
            "lat": 35.0094,
            "lng": 135.6739,
            "cost": 35,
            "why": "Morning transfer to western bamboo and temple district",
            "note": "30-minute ride; arrive before 9 AM to beat tour groups",
            "time": "8:00 AM",
            "durationLabel": "30 minutes",
            "category": "transit",
            "tags": [
              "Transfer"
            ]
          },
          {
            "name": "Arashiyama Bamboo Grove and Tenryu-ji Temple",
            "lat": 35.0156,
            "lng": 135.6739,
            "cost": 7,
            "why": "Iconic bamboo path at dawn, then Zen garden; photography-perfect light",
            "note": "Enter Tenryu-ji from north gate; combo garden + grounds ticket",
            "time": "8:45 AM",
            "durationLabel": "2 hours",
            "category": "entry",
            "tags": [
              "Must-See",
              "Photography"
            ]
          },
          {
            "name": "Okochi Sanso Villa",
            "lat": 35.0172,
            "lng": 135.6694,
            "cost": 10,
            "why": "Hillside villa with manicured gardens; fewer visitors than Tenryu-ji",
            "note": "10-minute walk through bamboo from Tenryu-ji; admission includes matcha",
            "time": "11:15 AM",
            "durationLabel": "1 hour",
            "category": "entry",
            "tags": [
              "Hidden Gem",
              "Garden"
            ]
          },
          {
            "name": "Lunch in Arashiyama",
            "lat": 35.0094,
            "lng": 135.6739,
            "cost": 42,
            "why": "Riverside tofu restaurants; yudofu specialty of the area",
            "note": "Shigetsu at Tenryu-ji or Saga Tofu Ine along the main street",
            "time": "12:30 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Local Specialty"
            ]
          },
          {
            "name": "Iwatayama Monkey Park",
            "lat": 35.0086,
            "lng": 135.6753,
            "cost": 8,
            "why": "Mountain hike with wild macaques and city views; nature + photography",
            "note": "20-minute uphill walk; feed monkeys at summit; closes 4:30 PM",
            "time": "2:00 PM",
            "durationLabel": "1.5 hours",
            "category": "entry",
            "tags": [
              "Nature",
              "Hiking"
            ]
          },
          {
            "name": "Taxi back to central Kyoto",
            "lat": 35.0116,
            "lng": 135.7681,
            "cost": 35,
            "why": "Return transfer from Arashiyama to Gion area",
            "note": "30-minute ride; arrive in time to rest before dinner",
            "time": "4:00 PM",
            "durationLabel": "30 minutes",
            "category": "transit",
            "tags": [
              "Transfer"
            ]
          },
          {
            "name": "Matcha dessert and rest",
            "lat": 35.0033,
            "lng": 135.7751,
            "cost": 18,
            "why": "Gion sweets break; matcha parfait or warabi-mochi",
            "note": "Tsujiri or Gion Komori; rest before final dinner",
            "time": "5:00 PM",
            "durationLabel": "45 minutes",
            "category": "food",
            "tags": [
              "Sweets"
            ]
          },
          {
            "name": "Dinner in Kiyamachi or Pontocho",
            "lat": 35.0041,
            "lng": 135.7692,
            "cost": 110,
            "why": "Riverfront farewell meal; tofu kaiseki or Kyoto-style shabu-shabu",
            "note": "Book ahead for riverside terrace; Kiyamachi less touristy than Pontocho",
            "time": "7:00 PM",
            "durationLabel": "2 hours",
            "category": "food",
            "tags": [
              "River View",
              "Fine Dining"
            ]
          }
        ]
      },
      {
        "date": "2026-09-22",
        "weather": "No weather data available",
        "summary": "Honor the Autumnal Equinox with a temple ceremony and Zen meditation, then a final golden pavilion visit and leisurely lunch before departing Kyoto. 🍂⛩️",
        "stops": [
          {
            "name": "Nanzen-ji Temple Equinox ceremony",
            "lat": 35.0109,
            "lng": 135.7936,
            "cost": 6,
            "why": "National holiday observance at Zen temple; higan-e ritual at 9 AM",
            "note": "Arrive early; ceremony open to public; brick aqueduct photogenic",
            "time": "8:45 AM",
            "durationLabel": "1.5 hours",
            "category": "entry",
            "tags": [
              "Cultural Event",
              "Holiday"
            ]
          },
          {
            "name": "Kinkaku-ji (Golden Pavilion)",
            "lat": 35.0394,
            "lng": 135.7292,
            "cost": 5,
            "why": "Kyoto's icon; visiting late morning on holiday means mixed crowds",
            "note": "Taxi 20 min from Nanzen-ji; one-way path through garden",
            "time": "11:00 AM",
            "durationLabel": "1 hour",
            "category": "entry",
            "tags": [
              "Must-See",
              "Photography"
            ]
          },
          {
            "name": "Taxi to Kinkaku-ji and return to central Kyoto",
            "lat": 35.0394,
            "lng": 135.7292,
            "cost": 45,
            "why": "Round-trip taxi for temple visit; efficient on last day",
            "note": "20 min each way; return to Kawaramachi for lunch and shopping",
            "time": "10:40 AM",
            "durationLabel": "40 minutes",
            "category": "transit",
            "tags": [
              "Round-trip"
            ]
          },
          {
            "name": "Farewell lunch in Teramachi arcade",
            "lat": 35.0069,
            "lng": 135.7664,
            "cost": 50,
            "why": "Covered shopping street with restaurants; grab souvenirs after eating",
            "note": "Tonkatsu Katsukura or tempura; Teramachi runs parallel to Kawaramachi",
            "time": "12:30 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Shopping District"
            ]
          },
          {
            "name": "Final shopping in Teramachi and Shinkyogoku arcades",
            "lat": 35.0069,
            "lng": 135.7664,
            "cost": 95,
            "why": "Covered alleys with traditional crafts, tea, ceramics, stationery",
            "note": "Two parallel arcades; fans, furoshiki, incense; tax-free counters",
            "time": "1:45 PM",
            "durationLabel": "1.5 hours",
            "category": "other",
            "tags": [
              "Shopping",
              "Souvenirs"
            ]
          },
          {
            "name": "Taxi to Kyoto Station",
            "lat": 34.9858,
            "lng": 135.7581,
            "cost": 25,
            "why": "Departure transfer with luggage and shopping bags",
            "note": "15-minute ride; allow extra time for station size and train check-in",
            "time": "3:45 PM",
            "durationLabel": "15 minutes",
            "category": "transit",
            "tags": [
              "Departure"
            ]
          }
        ]
      }
    ]
  },

  "lisbon-solo-offbeat": {
    "tier": "midrange",
    "days": [
      {
        "date": "2026-10-08",
        "weather": "No weather data available",
        "summary": "Dive into Lisbon's historic heart with castle views and traditional fado in atmospheric Alfama. 🏰🎶",
        "lodging": {
          "name": "Boutique hotel in Baixa",
          "cost": 170,
          "note": "Central location for walkable access to food scene and nightlife; alternative: Chiado guesthouse"
        },
        "stops": [
          {
            "name": "Time Out Market area",
            "lat": 38.7063,
            "lng": -9.146,
            "cost": 30,
            "why": "Lisbon's premier food hall showcases top chefs and local vendors under one roof",
            "note": "Try counters like Henrique Sá Pessoa or Alexandre Silva; arrive before 1pm for seating",
            "time": "12:00 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Food Focus",
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Baixa and Rossio exploration",
            "lat": 38.7141,
            "lng": -9.1394,
            "cost": 0,
            "why": "Pedestrian grid with shops and cafés lets solo travelers meander at their own pace",
            "note": "Rua Augusta arch offers rooftop views for 3€; watch for pickpockets in crowds",
            "time": "2:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Free",
              "Photography"
            ],
            "category": "other"
          },
          {
            "name": "São Jorge Castle",
            "lat": 38.7139,
            "lng": -9.1336,
            "cost": 10,
            "why": "Panoramic viewpoints reward the climb and deliver golden-hour photography opportunities",
            "note": "15-minute uphill walk from Baixa; ramparts stay open until 9pm in October",
            "time": "4:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Must-See",
              "Photography"
            ],
            "category": "entry"
          },
          {
            "name": "Alfama neighborhood walk",
            "lat": 38.7115,
            "lng": -9.1301,
            "cost": 0,
            "why": "Narrow lanes and tiled facades offer unfiltered glimpses of Lisbon's oldest quarter",
            "note": "Descend from castle through Largo das Portas do Sol; cobblestones can be slippery",
            "time": "6:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Free",
              "Local Pick"
            ],
            "category": "other"
          },
          {
            "name": "Dinner in Alfama",
            "lat": 38.7115,
            "lng": -9.1301,
            "cost": 55,
            "why": "Traditional tascas serve grilled sardines and petiscos in the fado heartland",
            "note": "Pateo 13 or Farol de Santa Luzia for outdoor tables; book ahead for peak dining hours",
            "time": "8:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Local Pick",
              "Food Focus"
            ],
            "category": "food"
          },
          {
            "name": "Fado show at Mesa de Frades or similar venue",
            "lat": 38.7115,
            "lng": -9.1301,
            "cost": 50,
            "why": "Live fado delivers Lisbon's soulful soundtrack in an intimate chapel setting",
            "note": "Most shows start 9:30-10pm; cover includes one drink; reserve day-of for solo seating",
            "time": "10:00 PM",
            "durationLabel": "2 hours",
            "tags": [
              "Must-See",
              "After Dark"
            ],
            "category": "entry"
          }
        ]
      },
      {
        "date": "2026-10-09",
        "weather": "No weather data available",
        "summary": "Belém's grand monuments and iconic pastries by day, Bairro Alto's vibrant bar scene by night. 🏛️🍻",
        "lodging": {
          "name": "Boutique hotel in Baixa",
          "cost": 170,
          "note": "Central location for walkable access to food scene and nightlife; alternative: Chiado guesthouse"
        },
        "stops": [
          {
            "name": "Taxi to Belém",
            "lat": 38.6979,
            "lng": -9.2063,
            "cost": 12,
            "why": "Direct ride saves time versus crowded Tram 28 for morning monument visits",
            "note": "20-minute ride from Baixa; alternatively take tram 15E for local color",
            "time": "9:00 AM",
            "durationLabel": "30 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Pastéis de Belém",
            "lat": 38.6976,
            "lng": -9.2033,
            "cost": 10,
            "why": "Iconic 1837 bakery uses the original secret recipe for Portugal's famous custard tarts",
            "note": "Counter service is faster than table seating; try them warm with cinnamon",
            "time": "9:30 AM",
            "durationLabel": "30 minutes",
            "tags": [
              "Must-See",
              "Food Focus"
            ],
            "category": "food"
          },
          {
            "name": "Jerónimos Monastery",
            "lat": 38.6979,
            "lng": -9.2063,
            "cost": 12,
            "why": "Manueline architecture and maritime history anchor Portugal's Age of Discovery legacy",
            "note": "5-minute walk from pastry shop; cloisters open 10am, arrive early to avoid tour groups",
            "time": "10:30 AM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Must-See",
              "Culture"
            ],
            "category": "entry"
          },
          {
            "name": "Belém Tower",
            "lat": 38.6916,
            "lng": -9.216,
            "cost": 8,
            "why": "Riverside fortress offers rooftop views and completes the Belém monument circuit",
            "note": "15-minute riverside walk from monastery; combined ticket available for 2€ savings",
            "time": "12:30 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Must-See",
              "Photography"
            ],
            "category": "entry"
          },
          {
            "name": "Lunch in Belém waterfront area",
            "lat": 38.6979,
            "lng": -9.2063,
            "cost": 40,
            "why": "Seafood restaurants along the Tagus let solo diners watch river traffic over grilled fish",
            "note": "Ponto Final across the water or Enoteca de Belém for wine pairings; outdoor tables available",
            "time": "2:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Food Focus",
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "LX Factory",
            "lat": 38.7055,
            "lng": -9.177,
            "cost": 40,
            "why": "Converted industrial complex houses independent designers and vintage shops for unique finds",
            "note": "10-minute taxi from Belém; Ler Devagar bookstore anchors the creative hub",
            "time": "4:00 PM",
            "durationLabel": "2 hours",
            "tags": [
              "Local Pick",
              "Shopping"
            ],
            "category": "other"
          },
          {
            "name": "Taxi back to Bairro Alto",
            "lat": 38.7139,
            "lng": -9.1456,
            "cost": 8,
            "why": "Quick return to central nightlife district for dinner and bar hopping",
            "note": "15-minute ride; alternatively take tram 28 if not rush hour",
            "time": "6:30 PM",
            "durationLabel": "30 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Dinner in Bairro Alto",
            "lat": 38.7139,
            "lng": -9.1456,
            "cost": 60,
            "why": "Hillside neighborhood mixes traditional cervejarias with modern fusion for diverse solo dining",
            "note": "Taberna da Rua das Flores or Cantinho do Avillez; arrive by 8pm to skip long waits",
            "time": "8:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Food Focus",
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Bairro Alto nightlife",
            "lat": 38.7139,
            "lng": -9.1456,
            "cost": 45,
            "why": "Dense concentration of bars lets solo travelers bar-hop through peak nightlife hours",
            "note": "Streets fill after 10pm; Pavilhão Chinês for quirky decor, Park for rooftop drinks",
            "time": "10:00 PM",
            "durationLabel": "2 hours",
            "tags": [
              "After Dark",
              "Local Pick"
            ],
            "category": "other"
          }
        ]
      },
      {
        "date": "2026-10-10",
        "weather": "No weather data available",
        "summary": "Saturday market treasures, hilltop panoramas, and a final taste of Lisbon's creative neighborhoods. 🛍️🌆",
        "stops": [
          {
            "name": "Feira da Ladra flea market",
            "lat": 38.7152,
            "lng": -9.1269,
            "cost": 40,
            "why": "Tuesday and Saturday market offers vintage tiles, antiques, and local crafts for browsing",
            "note": "Open 9am-5pm at Campo de Santa Clara; peak crowds mid-morning suit your comfort level",
            "time": "9:00 AM",
            "durationLabel": "2 hours",
            "tags": [
              "Local Pick",
              "Shopping"
            ],
            "category": "other"
          },
          {
            "name": "Miradouro da Graça",
            "lat": 38.7173,
            "lng": -9.1312,
            "cost": 0,
            "why": "Terrace viewpoint delivers sweeping castle-to-river panoramas for photography enthusiasts",
            "note": "5-minute uphill walk from market; Esplanada da Graça kiosk serves drinks with the view",
            "time": "11:30 AM",
            "durationLabel": "45 minutes",
            "tags": [
              "Free",
              "Photography"
            ],
            "category": "other"
          },
          {
            "name": "Coffee in Graça",
            "lat": 38.7173,
            "lng": -9.1312,
            "cost": 8,
            "why": "Neighborhood café break lets you recharge before lunch in a quiet local setting",
            "note": "Café da Graça or terrace kiosk; bica and pastel de nata pair well",
            "time": "12:30 PM",
            "durationLabel": "30 minutes",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Lunch in Graça area",
            "lat": 38.7173,
            "lng": -9.1312,
            "cost": 35,
            "why": "Residential quarter serves home-style Portuguese cooking away from tourist crowds",
            "note": "Tasca da Esquina for modern petiscos or Senhor Uva for wine-focused plates",
            "time": "1:30 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Local Pick",
              "Food Focus"
            ],
            "category": "food"
          },
          {
            "name": "Príncipe Real gardens and shopping",
            "lat": 38.7175,
            "lng": -9.1482,
            "cost": 57,
            "why": "Upscale boutiques and design shops around shaded gardens offer curated browsing before departure",
            "note": "20-minute walk or short taxi from Graça; Embaixada concept store in former palace",
            "time": "3:30 PM",
            "durationLabel": "2 hours",
            "tags": [
              "Shopping",
              "Local Pick"
            ],
            "category": "other"
          }
        ]
      }
    ]
  },

  "rome-family-slow": {
    "tier": "midrange",
    "days": [
      {
        "date": "2026-11-01",
        "weather": "No weather data available",
        "summary": "A gentle arrival day exploring Villa Borghese's gardens and zoo, perfect for families seeking open-air culture on a national holiday. 🌳🦁",
        "lodging": {
          "name": "Boutique hotel in Prati",
          "cost": 180,
          "note": "Near Vatican, walkable cafes, family rooms available; alternative: apartment in Trastevere"
        },
        "stops": [
          {
            "name": "Villa Borghese Gardens",
            "lat": 41.9116,
            "lng": 12.4922,
            "cost": 0,
            "why": "Free tranquil park, no stairs, plenty of benches — ideal for slow-paced exploring",
            "note": "All Saints' Day closures won't affect this outdoor space; enter from Pinciana gate",
            "time": "10:00 AM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Free",
              "Local Pick"
            ],
            "category": "other"
          },
          {
            "name": "Lunch in Pinciano neighborhood",
            "lat": 41.9133,
            "lng": 12.4945,
            "cost": 75,
            "why": "Family-friendly trattorias near the park; e.g. Al Ceppo for Roman classics",
            "note": "5-minute walk from Villa Borghese; many spots open despite holiday",
            "time": "12:30 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Bioparco di Roma",
            "lat": 41.9116,
            "lng": 12.4922,
            "cost": 75,
            "why": "Rome's zoo within Villa Borghese — kids love it, minimal walking between enclosures",
            "note": "Open on holidays; 10-minute walk from lunch, go to reptile house first when quieter",
            "time": "2:30 PM",
            "durationLabel": "2 hours",
            "tags": [
              "Family-Friendly"
            ],
            "category": "entry"
          },
          {
            "name": "Gelato break at Gelateria Fatamorgana",
            "lat": 41.9105,
            "lng": 12.4918,
            "cost": 18,
            "why": "Artisanal flavors, outdoor seating, rest stop for tired feet",
            "note": "Just outside Bioparco exit; kids can pick adventurous flavors",
            "time": "4:30 PM",
            "durationLabel": "30 minutes",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Taxi to Parioli",
            "lat": 41.924,
            "lng": 12.4875,
            "cost": 25,
            "why": "Short ride to upscale residential area, avoids evening walk with tired kids",
            "note": "15-minute ride; request child seats if needed",
            "time": "6:00 PM",
            "durationLabel": "15 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Dinner in Parioli area",
            "lat": 41.924,
            "lng": 12.4875,
            "cost": 95,
            "why": "Quieter upscale neighborhood with family-run spots; e.g. Metamorfosi or Al Ceppo",
            "note": "Book ahead for nicer places; ask for early seating around 7pm for kids",
            "time": "7:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Reservation Needed"
            ],
            "category": "food"
          }
        ]
      },
      {
        "date": "2026-11-02",
        "weather": "No weather data available",
        "summary": "Dive into papal history at Castel Sant'Angelo and the Vatican Museums, timed to avoid the crowds. 🏰🎨",
        "lodging": {
          "name": "Boutique hotel in Prati",
          "cost": 180,
          "note": "Near Vatican, walkable cafes, family rooms available; alternative: apartment in Trastevere"
        },
        "stops": [
          {
            "name": "Castel Sant'Angelo",
            "lat": 41.9031,
            "lng": 12.4663,
            "cost": 60,
            "why": "Fortress with sweeping views, elevator available, fewer crowds than Colosseum",
            "note": "Arrive at opening; spiral ramp inside is gentle, skip upper terraces if mobility limited",
            "time": "9:00 AM",
            "durationLabel": "2 hours",
            "tags": [
              "Culture",
              "History"
            ],
            "category": "entry"
          },
          {
            "name": "Taxi to Vatican area",
            "lat": 41.9029,
            "lng": 12.4534,
            "cost": 20,
            "why": "Quick ride saves energy for Vatican Museums, no stairs to navigate",
            "note": "5-minute ride across the river; driver can drop at museum entrance",
            "time": "11:30 AM",
            "durationLabel": "15 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Lunch near Vatican in Borgo Pio",
            "lat": 41.9023,
            "lng": 12.4603,
            "cost": 85,
            "why": "Medieval street with cozy trattorias; e.g. Ristorante dei Musei for cacio e pepe",
            "note": "5-minute walk from Castel Sant'Angelo; less touristy than Via della Conciliazione",
            "time": "12:00 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Vatican Museums",
            "lat": 41.9065,
            "lng": 12.4536,
            "cost": 110,
            "why": "Sistine Chapel and ancient galleries; skip-the-line tickets beat afternoon crowds",
            "note": "Book 2pm entry online; take elevator where offered, rest in courtyard gardens",
            "time": "2:00 PM",
            "durationLabel": "2.5 hours",
            "tags": [
              "Must-See",
              "Reservation Needed"
            ],
            "category": "entry"
          },
          {
            "name": "Rest and gelato at Gelateria dei Gracchi",
            "lat": 41.9065,
            "lng": 12.459,
            "cost": 20,
            "why": "Local favorite near museums, outdoor tables, perfect post-culture breather",
            "note": "10-minute walk from museum exit; pistachio and ricotta flavors are standout",
            "time": "4:30 PM",
            "durationLabel": "45 minutes",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Taxi to Prati for dinner",
            "lat": 41.9095,
            "lng": 12.4655,
            "cost": 20,
            "why": "Short ride to residential dining area, saves evening walk after museum visit",
            "note": "10-minute ride; Prati has many mid-range family spots",
            "time": "6:00 PM",
            "durationLabel": "15 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Dinner in Prati neighborhood",
            "lat": 41.9095,
            "lng": 12.4655,
            "cost": 100,
            "why": "Authentic Roman cuisine away from tourist traps; e.g. L'Arcangelo or Osteria Angelina",
            "note": "Book ahead; request early seating; many places have high chairs",
            "time": "7:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Reservation Needed"
            ],
            "category": "food"
          }
        ]
      },
      {
        "date": "2026-11-03",
        "weather": "No weather data available",
        "summary": "Ancient Roman baths and hands-on science fun, balancing history with interactive play for young minds. 🏛️🔬",
        "lodging": {
          "name": "Boutique hotel in Prati",
          "cost": 180,
          "note": "Near Vatican, walkable cafes, family rooms available; alternative: apartment in Trastevere"
        },
        "stops": [
          {
            "name": "Taxi to Baths of Caracalla",
            "lat": 41.8797,
            "lng": 12.4922,
            "cost": 25,
            "why": "Direct ride south, saves long Metro transfer with kids and bags",
            "note": "20-minute ride from Prati; driver drops at main entrance",
            "time": "9:00 AM",
            "durationLabel": "20 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Baths of Caracalla",
            "lat": 41.8797,
            "lng": 12.4922,
            "cost": 50,
            "why": "Massive ancient ruins, flat terrain, far fewer crowds than Forum or Palatine",
            "note": "Open at 9am; explore early before sun heats the stone; shaded mosaics inside",
            "time": "9:30 AM",
            "durationLabel": "1.5 hours",
            "tags": [
              "History",
              "Culture"
            ],
            "category": "entry"
          },
          {
            "name": "Taxi to Testaccio",
            "lat": 41.8761,
            "lng": 12.4762,
            "cost": 20,
            "why": "Quick ride to authentic food district, avoids uphill walk",
            "note": "10-minute ride; Testaccio is Rome's traditional working-class heart",
            "time": "11:30 AM",
            "durationLabel": "15 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Lunch in Testaccio neighborhood",
            "lat": 41.8761,
            "lng": 12.4762,
            "cost": 85,
            "why": "Local Roman food haven; e.g. Flavio al Velavevodetto for offal or pasta classics",
            "note": "Market nearby if kids want to browse; most spots open 12:30-3pm",
            "time": "12:00 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Taxi to Explora Museum",
            "lat": 41.9267,
            "lng": 12.4711,
            "cost": 25,
            "why": "Direct ride north to children's museum, avoids two Metro changes",
            "note": "25-minute ride; museum is near Flaminio, Villa Borghese edge",
            "time": "2:00 PM",
            "durationLabel": "20 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Explora Children's Museum",
            "lat": 41.9267,
            "lng": 12.4711,
            "cost": 65,
            "why": "Interactive exhibits for kids, all indoors, hands-on science and play",
            "note": "Book timed entry online; sessions run 1h 45m; supermarket play area is highlight",
            "time": "2:30 PM",
            "durationLabel": "2 hours",
            "tags": [
              "Family-Friendly",
              "Reservation Needed"
            ],
            "category": "entry"
          },
          {
            "name": "Gelato and rest at Giolitti",
            "lat": 41.9005,
            "lng": 12.4771,
            "cost": 18,
            "why": "Historic gelateria, indoor seating, chance to sit and recharge",
            "note": "Taxi 15 min or walk through Villa Borghese; vast flavor selection",
            "time": "4:30 PM",
            "durationLabel": "30 minutes",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Taxi to Trastevere",
            "lat": 41.8892,
            "lng": 12.4686,
            "cost": 25,
            "why": "Evening ride to charming neighborhood, skips rush-hour crowds on transit",
            "note": "20-minute ride; Trastevere cobblestones are bumpy but area is pedestrianized",
            "time": "6:00 PM",
            "durationLabel": "20 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Dinner in Trastevere",
            "lat": 41.8892,
            "lng": 12.4686,
            "cost": 95,
            "why": "Cozy neighborhood vibe, outdoor tables; e.g. Tonnarello or Da Enzo al 29",
            "note": "Book ahead for Da Enzo; arrive 7pm sharp to beat dinner rush",
            "time": "7:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Local Pick",
              "Reservation Needed"
            ],
            "category": "food"
          }
        ]
      },
      {
        "date": "2026-11-04",
        "weather": "No weather data available",
        "summary": "A morning among Ostia's ancient streets followed by market browsing and riverside dining back in Rome. 🏺🌿",
        "lodging": {
          "name": "Boutique hotel in Prati",
          "cost": 180,
          "note": "Near Vatican, walkable cafes, family rooms available; alternative: apartment in Trastevere"
        },
        "stops": [
          {
            "name": "Train to Ostia Antica",
            "lat": 41.7562,
            "lng": 12.2924,
            "cost": 12,
            "why": "Regional train from Piramide, scenic ride, kids enjoy train travel",
            "note": "45-minute ride; buy tickets at station or tabacchi, validate before boarding",
            "time": "9:00 AM",
            "durationLabel": "45 minutes",
            "tags": [
              "Scenic"
            ],
            "category": "transit"
          },
          {
            "name": "Ostia Antica archaeological site",
            "lat": 41.7562,
            "lng": 12.2924,
            "cost": 55,
            "why": "Pompeii-like ruins with zero crowds, flat paths, kids can roam freely",
            "note": "5-minute walk from station; bring water, limited shade; see theater and baths first",
            "time": "10:00 AM",
            "durationLabel": "2.5 hours",
            "tags": [
              "History",
              "Culture"
            ],
            "category": "entry"
          },
          {
            "name": "Lunch in Ostia Antica village",
            "lat": 41.7545,
            "lng": 12.2935,
            "cost": 80,
            "why": "Small village near ruins with family trattorias; e.g. Ristorante Monumento",
            "note": "5-minute walk from site exit; quiet square, fresh seafood options",
            "time": "12:30 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Train back to Rome",
            "lat": 41.8758,
            "lng": 12.48,
            "cost": 12,
            "why": "Return to city center, kids can rest on train after morning exploring",
            "note": "45-minute ride to Piramide; sit on right side for Tiber views",
            "time": "2:00 PM",
            "durationLabel": "45 minutes",
            "tags": [
              "Scenic"
            ],
            "category": "transit"
          },
          {
            "name": "Campo de' Fiori market and shopping",
            "lat": 41.8955,
            "lng": 12.4718,
            "cost": 150,
            "why": "Morning market for browsing, afternoon artisan shops, open-air square with cafes",
            "note": "Taxi 15 min from Piramide; market winds down by 2pm but shops stay open; buy spices, ceramics",
            "time": "3:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Shopping",
              "Local Pick"
            ],
            "category": "other"
          },
          {
            "name": "Coffee and pastry break at Forno Campo de' Fiori",
            "lat": 41.8958,
            "lng": 12.4715,
            "cost": 15,
            "why": "Famous bakery at square's edge, outdoor benches, sweet rest stop",
            "note": "Try pizza bianca; stand at counter or take pastries to square",
            "time": "5:00 PM",
            "durationLabel": "30 minutes",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Taxi to Trastevere",
            "lat": 41.8892,
            "lng": 12.4686,
            "cost": 20,
            "why": "Short evening ride across river, saves walk on cobblestones with shopping bags",
            "note": "10-minute ride; drop near Piazza di Santa Maria for dinner zone",
            "time": "6:30 PM",
            "durationLabel": "15 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Dinner in Trastevere by the river",
            "lat": 41.8892,
            "lng": 12.4686,
            "cost": 100,
            "why": "Romantic riverside tables, local trattorias; e.g. Osteria der Belli or Spirito DiVino",
            "note": "Book ahead; many spots have outdoor heaters in November",
            "time": "7:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Reservation Needed"
            ],
            "category": "food"
          }
        ]
      },
      {
        "date": "2026-11-05",
        "weather": "No weather data available",
        "summary": "Walk in ancient footsteps along the Appian Way, then a final stroll through Rome's chic shopping heart. 🛤️🛍️",
        "stops": [
          {
            "name": "Taxi to Appian Way",
            "lat": 41.8583,
            "lng": 12.5147,
            "cost": 30,
            "why": "Direct morning ride to ancient road, avoids complicated bus connections",
            "note": "30-minute ride southeast; ask driver for Catacombe di San Callisto entrance",
            "time": "9:00 AM",
            "durationLabel": "25 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Appian Way and Catacombs",
            "lat": 41.8583,
            "lng": 12.5147,
            "cost": 45,
            "why": "Ancient road and underground tombs, deeply historic, minimal crowds mid-morning",
            "note": "Tour catacombs first (book ahead); flat cobbled path outside, bring water",
            "time": "9:30 AM",
            "durationLabel": "2 hours",
            "tags": [
              "History",
              "Culture"
            ],
            "category": "entry"
          },
          {
            "name": "Lunch in Appio Latino area",
            "lat": 41.865,
            "lng": 12.525,
            "cost": 80,
            "why": "Local residential neighborhood near Appian Way; e.g. Ristorante Cecilia Metella",
            "note": "10-minute walk or short taxi from catacombs; quiet family spot with garden seating",
            "time": "12:00 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Taxi to Via del Corso",
            "lat": 41.9028,
            "lng": 12.4798,
            "cost": 25,
            "why": "Return to city center for shopping, skips long Metro ride with tired kids",
            "note": "25-minute ride; drop at Piazza del Popolo end of Corso for downhill stroll",
            "time": "2:00 PM",
            "durationLabel": "20 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Via del Corso shopping",
            "lat": 41.9028,
            "lng": 12.4798,
            "cost": 120,
            "why": "Main shopping street with Italian and international brands, pedestrian-friendly",
            "note": "Stroll from Popolo toward Piazza Venezia; Zara, Mango, and local boutiques; mostly flat",
            "time": "2:30 PM",
            "durationLabel": "2 hours",
            "tags": [
              "Shopping"
            ],
            "category": "other"
          },
          {
            "name": "Coffee and rest at Caffè Greco",
            "lat": 41.9056,
            "lng": 12.4822,
            "cost": 15,
            "why": "Historic cafe near Spanish Steps, elegant sit-down break, classic Roman experience",
            "note": "5-minute walk from Corso; pricey but worth it for atmosphere; indoor seating",
            "time": "5:00 PM",
            "durationLabel": "30 minutes",
            "tags": [
              "Historic"
            ],
            "category": "food"
          },
          {
            "name": "Taxi to Centro Storico",
            "lat": 41.8986,
            "lng": 12.473,
            "cost": 20,
            "why": "Short ride to historic center for farewell dinner, saves walk with shopping bags",
            "note": "10-minute ride; drop near Pantheon or Piazza Navona",
            "time": "6:30 PM",
            "durationLabel": "15 minutes",
            "tags": [
              "Convenience"
            ],
            "category": "transit"
          },
          {
            "name": "Early dinner in Centro Storico",
            "lat": 41.8986,
            "lng": 12.473,
            "cost": 85,
            "why": "Farewell meal near Pantheon; e.g. Armando al Pantheon for traditional Roman cuisine",
            "note": "Book ahead; early seating works for families; close to hotel for easy post-dinner return",
            "time": "7:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Reservation Needed"
            ],
            "category": "food"
          }
        ]
      }
    ]
  },

  "reykjavik-couple-packed": {
    "tier": "midrange",
    "days": [
      {
        "date": "2027-02-12",
        "weather": "Limited daylight (7-8 hours); typical February winter conditions",
        "summary": "Arrive in Reykjavik and explore the city's iconic landmarks, culminating in an evening Northern Lights hunt. 🌌📸",
        "lodging": {
          "name": "Boutique hotel in central Reykjavik",
          "cost": 360,
          "note": "Walkable to all downtown sights; alternative: guesthouse for local charm at ~$200/night"
        },
        "stops": [
          {
            "name": "Private airport transfer to Reykjavik",
            "lat": 64.1466,
            "lng": -21.9426,
            "cost": 150,
            "why": "Convenient 4WD transport in winter conditions for couples",
            "note": "45-minute drive from KEF; driver can share Northern Lights forecast",
            "time": "10:00 AM",
            "durationLabel": "1 hour",
            "category": "transit",
            "tags": [
              "Arrival",
              "Private"
            ]
          },
          {
            "name": "Coffee and light breakfast downtown",
            "lat": 64.1466,
            "lng": -21.9426,
            "cost": 20,
            "why": "Fuel up after the flight before city exploration",
            "note": "Try Reykjavik Roasters or Sandholt Bakery on Laugavegur",
            "time": "11:15 AM",
            "durationLabel": "45 minutes",
            "category": "food",
            "tags": [
              "Local Pick"
            ]
          },
          {
            "name": "Hallgrímskirkja Church tower",
            "lat": 64.1426,
            "lng": -21.9266,
            "cost": 10,
            "why": "Iconic architecture and 360° city views for photography in daylight",
            "note": "Elevator to top; best light before 3pm in February for outdoor shots",
            "time": "12:15 PM",
            "durationLabel": "1 hour",
            "category": "entry",
            "tags": [
              "Must-See",
              "Photography"
            ]
          },
          {
            "name": "Lunch around Old Harbour",
            "lat": 64.1503,
            "lng": -21.9408,
            "cost": 60,
            "why": "Fresh seafood heart of the city; 10-minute walk from church",
            "note": "Try Sægreifinn (Sea Baron) for lobster soup or Messinn for fish",
            "time": "1:30 PM",
            "durationLabel": "1.5 hours",
            "category": "food",
            "tags": [
              "Local Pick",
              "Seafood"
            ]
          },
          {
            "name": "Harpa Concert Hall",
            "lat": 64.15,
            "lng": -21.9326,
            "cost": 0,
            "why": "Stunning geometric glass architecture and waterfront photo ops",
            "note": "Free to explore exterior and public areas; café inside for warm-up",
            "time": "3:15 PM",
            "durationLabel": "45 minutes",
            "category": "other",
            "tags": [
              "Free",
              "Photography"
            ]
          },
          {
            "name": "Sun Voyager sculpture",
            "lat": 64.1478,
            "lng": -21.9223,
            "cost": 0,
            "why": "Dramatic coastal monument perfect for sunset/blue hour photography",
            "note": "5-minute walk along waterfront from Harpa; best photos around 4pm",
            "time": "4:15 PM",
            "durationLabel": "30 minutes",
            "category": "other",
            "tags": [
              "Free",
              "Photography"
            ]
          },
          {
            "name": "Old Harbour walking exploration",
            "lat": 64.1503,
            "lng": -21.9408,
            "cost": 0,
            "why": "Historic harbor atmosphere with mountain/water backdrops for photos",
            "note": "Check out FlyOver Iceland here or save for Day 3; Maritime Museum nearby",
            "time": "5:00 PM",
            "durationLabel": "1 hour",
            "category": "other",
            "tags": [
              "Free",
              "Local Pick"
            ]
          },
          {
            "name": "Dinner in downtown Reykjavik",
            "lat": 64.1466,
            "lng": -21.9426,
            "cost": 140,
            "why": "Upscale dining to celebrate arrival; walkable from harbor",
            "note": "Grillmarkaðurinn or Dill for modern Icelandic; reserve ahead",
            "time": "7:30 PM",
            "durationLabel": "2 hours",
            "category": "food",
            "tags": [
              "Reservation Needed"
            ]
          },
          {
            "name": "Private Northern Lights photography tour",
            "lat": 64.1466,
            "lng": -21.9426,
            "cost": 320,
            "why": "Peak aurora season and top priority for nature/photography couple",
            "note": "Private tour allows flexible stops for best shots; hotel pickup ~9:30pm",
            "time": "10:00 PM",
            "durationLabel": "4 hours",
            "category": "entry",
            "tags": [
              "Must-See",
              "Photography"
            ]
          }
        ]
      },
      {
        "date": "2027-02-13",
        "weather": "Winter conditions; check road.is before departure",
        "summary": "Journey through Iceland's Golden Circle with dramatic landscapes from Þingvellir's rift valley to Gullfoss' frozen cascades. ❄️🏔️",
        "lodging": {
          "name": "Boutique hotel in central Reykjavik",
          "cost": 360,
          "note": "Same base as previous night; no need to repack or switch hotels"
        },
        "stops": [
          {
            "name": "Breakfast at hotel or nearby café",
            "lat": 64.1466,
            "lng": -21.9426,
            "cost": 25,
            "why": "Early start for full Golden Circle day with good weather light",
            "note": "Grab-and-go option if hotel breakfast isn't included",
            "time": "8:00 AM",
            "durationLabel": "45 minutes",
            "category": "food",
            "tags": [
              "Quick"
            ]
          },
          {
            "name": "Private Golden Circle guided tour",
            "lat": 64.1466,
            "lng": -21.9426,
            "cost": 700,
            "why": "Full-day private tour covering major Golden Circle sites with flexible photo stops for nature and photography priorities",
            "note": "Includes transport, guide, and access to all Golden Circle sites; hotel pickup",
            "time": "9:00 AM",
            "durationLabel": "Full day",
            "category": "transit",
            "tags": [
              "Private",
              "Photography"
            ]
          },
          {
            "name": "Þingvellir National Park",
            "lat": 64.2558,
            "lng": -21.1299,
            "cost": 0,
            "why": "UNESCO site with rift valley and dramatic winter geology for photos",
            "note": "Included in Golden Circle tour; 45-min drive from Reykjavik",
            "time": "9:45 AM",
            "durationLabel": "1.5 hours",
            "category": "other",
            "tags": [
              "Must-See",
              "Photography"
            ]
          },
          {
            "name": "Geysir geothermal area",
            "lat": 64.3105,
            "lng": -20.3014,
            "cost": 0,
            "why": "Active Strokkur geyser erupts every 5-10 min; incredible for action shots",
            "note": "Included in tour; bring wide-angle lens for steam/eruption",
            "time": "11:30 AM",
            "durationLabel": "1 hour",
            "category": "other",
            "tags": [
              "Must-See",
              "Free"
            ]
          },
          {
            "name": "Lunch at Friðheimar greenhouse",
            "lat": 64.2689,
            "lng": -20.4456,
            "cost": 85,
            "why": "Unique tomato greenhouse dining experience on the Golden Circle route",
            "note": "Farm-to-table menu; reserve through tour operator; 15-min detour",
            "time": "12:45 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Local Pick",
              "Reservation Needed"
            ]
          },
          {
            "name": "Gullfoss waterfall",
            "lat": 64.3271,
            "lng": -20.1211,
            "cost": 0,
            "why": "Iceland's most dramatic waterfall; winter ice formations are stunning",
            "note": "Walkways can be icy; wear crampons; afternoon light good for rainbows",
            "time": "2:00 PM",
            "durationLabel": "1 hour",
            "category": "other",
            "tags": [
              "Must-See",
              "Free"
            ]
          },
          {
            "name": "Kerið volcanic crater",
            "lat": 64.041,
            "lng": -20.8851,
            "cost": 10,
            "why": "Vivid red crater with frozen lake; compact and photogenic",
            "note": "Quick stop on return route; walk around rim for 360° views",
            "time": "3:15 PM",
            "durationLabel": "30 minutes",
            "category": "entry",
            "tags": [
              "Photography"
            ]
          },
          {
            "name": "Secret Lagoon (Gamla Laugin)",
            "lat": 64.1418,
            "lng": -20.3051,
            "cost": 50,
            "why": "Natural hot spring with steam in cold air; intimate and photogenic",
            "note": "Less crowded than Blue Lagoon; bring towel or rent on-site",
            "time": "4:00 PM",
            "durationLabel": "2 hours",
            "category": "entry",
            "tags": [
              "Nature",
              "Local Pick"
            ]
          },
          {
            "name": "Dinner in Reykjavik",
            "lat": 64.1466,
            "lng": -21.9426,
            "cost": 120,
            "why": "Return to city for hearty meal after full outdoor day",
            "note": "Try Sjavarkjallarinn (Seafood Cellar) or Fiskfélagið for upscale seafood",
            "time": "7:30 PM",
            "durationLabel": "1.5 hours",
            "category": "food",
            "tags": [
              "Local Pick"
            ]
          }
        ]
      },
      {
        "date": "2027-02-14",
        "weather": "Check forecast for Blue Lagoon trip timing",
        "summary": "Blend local culture at the flea market with relaxation at the Blue Lagoon, ending with a romantic Valentine's dinner. 💙🍽️",
        "lodging": {
          "name": "Boutique hotel in central Reykjavik",
          "cost": 360,
          "note": "Final night in same hotel; consistent home base throughout stay"
        },
        "stops": [
          {
            "name": "Breakfast at hotel",
            "lat": 64.1466,
            "lng": -21.9426,
            "cost": 25,
            "why": "Relaxed morning before market and spa day",
            "note": "Save energy for afternoon Blue Lagoon session",
            "time": "8:30 AM",
            "durationLabel": "45 minutes",
            "category": "food",
            "tags": [
              "Casual"
            ]
          },
          {
            "name": "Kolaportið Flea Market",
            "lat": 64.1478,
            "lng": -21.9447,
            "cost": 40,
            "why": "Sunday market for local culture and vintage Icelandic woolens",
            "note": "Open Sat-Sun only; near Old Harbour; cash helpful for vendors",
            "time": "9:30 AM",
            "durationLabel": "1.5 hours",
            "category": "other",
            "tags": [
              "Local Pick",
              "Shopping"
            ]
          },
          {
            "name": "Perlan Museum and observation deck",
            "lat": 64.1293,
            "lng": -21.9162,
            "cost": 35,
            "why": "Interactive exhibits on glaciers/aurora plus 360° city views for photos",
            "note": "10-min taxi from market; reserve 90 min for ice cave exhibit",
            "time": "11:15 AM",
            "durationLabel": "1.5 hours",
            "category": "entry",
            "tags": [
              "Photography",
              "Indoor"
            ]
          },
          {
            "name": "Lunch in Reykjavik",
            "lat": 64.1466,
            "lng": -21.9426,
            "cost": 50,
            "why": "Quick casual meal before Blue Lagoon trip",
            "note": "Grab something light on Laugavegur; Gló or Hlölla Bátar work well",
            "time": "1:00 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Quick"
            ]
          },
          {
            "name": "Blue Lagoon geothermal spa",
            "lat": 63.8804,
            "lng": -22.4495,
            "cost": 220,
            "why": "Iconic milky-blue waters in dramatic lava field; must-see photo spot",
            "note": "Premium package inc. robe, drink, Lava Restaurant; book ahead; 45-min drive",
            "time": "2:30 PM",
            "durationLabel": "3 hours",
            "category": "entry",
            "tags": [
              "Must-See",
              "Reservation Needed"
            ]
          },
          {
            "name": "Shopping on Laugavegur",
            "lat": 64.1448,
            "lng": -21.9311,
            "cost": 350,
            "why": "Main street for Icelandic design, wool, and outdoor gear souvenirs",
            "note": "Farmers & Friends, Álafoss, Geysir for quality woolens; evening hours",
            "time": "6:15 PM",
            "durationLabel": "1 hour",
            "category": "other",
            "tags": [
              "Shopping"
            ]
          },
          {
            "name": "FlyOver Iceland",
            "lat": 64.148,
            "lng": -21.9311,
            "cost": 35,
            "why": "Immersive flight ride showcasing Iceland's landscapes; fun pre-dinner",
            "note": "In Grandi harbor area; 7-min suspended ride with effects",
            "time": "7:30 PM",
            "durationLabel": "45 minutes",
            "category": "entry",
            "tags": [
              "Indoor",
              "Unique"
            ]
          },
          {
            "name": "Valentine's Day dinner",
            "lat": 64.1466,
            "lng": -21.9426,
            "cost": 200,
            "why": "Romantic fine dining to celebrate Valentine's and final night",
            "note": "Apotek or Matur og Drykkur for upscale Icelandic; reserve well ahead",
            "time": "8:45 PM",
            "durationLabel": "2 hours",
            "category": "food",
            "tags": [
              "Reservation Needed",
              "Romantic"
            ]
          }
        ]
      },
      {
        "date": "2027-02-15",
        "weather": "Check departure flight timing",
        "summary": "Leisurely morning stroll along the waterfront and final coffee before heading to the airport. ☕✈️",
        "stops": [
          {
            "name": "Breakfast at hotel",
            "lat": 64.1466,
            "lng": -21.9426,
            "cost": 25,
            "why": "Final Icelandic breakfast before checkout",
            "note": "Pack and prepare for departure; check flight status",
            "time": "8:30 AM",
            "durationLabel": "45 minutes",
            "category": "food",
            "tags": [
              "Casual"
            ]
          },
          {
            "name": "Waterfront walk and photo review",
            "lat": 64.1478,
            "lng": -21.9223,
            "cost": 0,
            "why": "Final sunrise/morning light shots along Reykjavik coast",
            "note": "Revisit Sun Voyager or harbor for last photos; 10-min walk from hotel",
            "time": "9:30 AM",
            "durationLabel": "1 hour",
            "category": "other",
            "tags": [
              "Free",
              "Photography"
            ]
          },
          {
            "name": "Coffee and last-minute browsing",
            "lat": 64.1448,
            "lng": -21.9311,
            "cost": 30,
            "why": "Final taste of Reykjavik café culture and gift pickup",
            "note": "Reykjavik Roasters or Kaffifélagið; shops open by 10am on Monday",
            "time": "10:45 AM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Casual",
              "Shopping"
            ]
          }
        ]
      }
    ]
  },

  "bangkok-solo-degraded": {
    "tier": "midrange",
    "days": [
      {
        "date": "2026-12-03",
        "weather": "Hot and sunny, 24-35°C",
        "summary": "Classic Bangkok temple circuit through the Grand Palace and riverside wats, finishing with shopping and dining at Asiatique's lively night market. 🛕✨",
        "lodging": {
          "name": "Boutique hotel in Silom",
          "cost": 85,
          "note": "Central BTS access to temples and markets; alternative: Sukhumvit for nightlife"
        },
        "stops": [
          {
            "name": "Breakfast near Silom",
            "lat": 13.7248,
            "lng": 100.5347,
            "cost": 12,
            "why": "Quick local breakfast to fuel temple touring",
            "note": "Street food stalls abundant; try jok (rice porridge) or khanom krok",
            "time": "8:00 AM",
            "durationLabel": "45 minutes",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Grand Palace & Wat Phra Kaew",
            "lat": 13.75,
            "lng": 100.4915,
            "cost": 17,
            "why": "Must-see cultural landmark with intricate architecture and the Emerald Buddha",
            "note": "Modest dress required (cover shoulders/knees); arrive early to beat crowds",
            "time": "9:00 AM",
            "durationLabel": "2 hours",
            "tags": [
              "Must-See",
              "Cultural"
            ],
            "category": "entry"
          },
          {
            "name": "Wat Pho",
            "lat": 13.7440374,
            "lng": 100.4915217,
            "cost": 7,
            "why": "Famous reclining Buddha and traditional massage school fit culture focus",
            "note": "5-minute walk from Grand Palace; less crowded, peaceful atmosphere",
            "time": "11:15 AM",
            "durationLabel": "1 hour",
            "tags": [
              "Cultural",
              "Photo Op"
            ],
            "category": "entry"
          },
          {
            "name": "Lunch in Rattanakosin",
            "lat": 13.748,
            "lng": 100.495,
            "cost": 18,
            "why": "Local eateries near temples serve authentic Thai cuisine",
            "note": "Try Tha Tian area by the river; e.g. Pa Aew or Savoey for fresh seafood",
            "time": "12:30 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "River ferry to Wat Arun",
            "lat": 13.7437,
            "lng": 100.4887,
            "cost": 2,
            "why": "Scenic Chao Phraya crossing is quintessential Bangkok experience",
            "note": "Cross from Tha Tien pier; boats run every 10 minutes",
            "time": "1:45 PM",
            "durationLabel": "15 minutes",
            "tags": [
              "Local Transport",
              "Scenic"
            ],
            "category": "transit"
          },
          {
            "name": "Wat Arun",
            "lat": 13.7437072,
            "lng": 100.488904,
            "cost": 3,
            "why": "Temple of Dawn's riverside spires are iconic Bangkok photo opportunities",
            "note": "Climb the central prang for river views; steep stairs but rewarding",
            "time": "2:00 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Must-See",
              "Photo Op"
            ],
            "category": "entry"
          },
          {
            "name": "Traditional Thai massage",
            "lat": 13.7465,
            "lng": 100.4927,
            "cost": 25,
            "why": "Wat Pho massage school offers authentic cultural experience mid-day",
            "note": "Return to Wat Pho's massage pavilion; book 1-hour traditional massage",
            "time": "3:30 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Local Experience",
              "Relaxation"
            ],
            "category": "other"
          },
          {
            "name": "Asiatique The Riverfront",
            "lat": 13.7034749,
            "lng": 100.5030426,
            "cost": 90,
            "why": "Night market combines shopping, riverfront dining, and lively evening buzz",
            "note": "Free shuttle boat from Saphan Taksin BTS; 1,500+ boutique shops plus eateries",
            "time": "6:00 PM",
            "durationLabel": "3 hours",
            "tags": [
              "Shopping",
              "Riverside"
            ],
            "category": "other"
          }
        ]
      },
      {
        "date": "2026-12-04",
        "weather": "Warm with possible afternoon clouds, 25-33°C",
        "summary": "Diving deep into Bangkok's shopping scene at Chatuchak's sprawling weekend market, silk heritage, and Chinatown's vibrant evening buzz. 🛍️🏮",
        "lodging": {
          "name": "Boutique hotel in Silom",
          "cost": 85,
          "note": "Central BTS access to temples and markets; alternative: Sukhumvit for nightlife"
        },
        "stops": [
          {
            "name": "Breakfast near hotel",
            "lat": 13.7248,
            "lng": 100.5347,
            "cost": 10,
            "why": "Quick fuel before marathon market browsing session",
            "note": "Hotel area has many options; save appetite for market snacking later",
            "time": "8:00 AM",
            "durationLabel": "30 minutes",
            "tags": [
              "Quick Bite"
            ],
            "category": "food"
          },
          {
            "name": "Chatuchak Weekend Market",
            "lat": 13.7991,
            "lng": 100.5498,
            "cost": 77,
            "why": "15,000 stalls match shopping priority; solo browsing thrives in this maze",
            "note": "Take BTS to Mo Chit; arrive early before peak crowds and midday heat",
            "time": "9:00 AM",
            "durationLabel": "3 hours",
            "tags": [
              "Shopping",
              "Local Pick"
            ],
            "category": "other"
          },
          {
            "name": "Lunch at Chatuchak",
            "lat": 13.7991,
            "lng": 100.5498,
            "cost": 15,
            "why": "Market food vendors offer authentic street food in energetic setting",
            "note": "Coconut ice cream, mango sticky rice, and pad thai stalls throughout sections",
            "time": "12:00 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Street Food",
              "Local Pick"
            ],
            "category": "food"
          },
          {
            "name": "Jim Thompson House",
            "lat": 13.7492247,
            "lng": 100.5282818,
            "cost": 10,
            "why": "Silk merchant's teak house museum bridges culture and shopping interests",
            "note": "BTS to National Stadium; guided tour only, English tours run regularly",
            "time": "1:45 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Cultural",
              "Museum"
            ],
            "category": "entry"
          },
          {
            "name": "MBK Center",
            "lat": 13.7443552,
            "lng": 100.5303629,
            "cost": 30,
            "why": "8-floor mall popular for affordable electronics, fashion, and souvenirs",
            "note": "Connected to National Stadium BTS; bargaining expected at many vendor stalls",
            "time": "3:30 PM",
            "durationLabel": "2 hours",
            "tags": [
              "Shopping",
              "Air-conditioned"
            ],
            "category": "other"
          },
          {
            "name": "Dinner in Siam area",
            "lat": 13.7465,
            "lng": 100.5347,
            "cost": 25,
            "why": "Central location between MBK and evening stop with diverse dining scene",
            "note": "Siam Square sois have Thai/international options; e.g. Som Tam Nua for Isaan",
            "time": "6:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Casual Dining"
            ],
            "category": "food"
          },
          {
            "name": "Chinatown (Yaowarat)",
            "lat": 13.7392,
            "lng": 100.5067,
            "cost": 20,
            "why": "Night market energy and street food align perfectly with food-culture priorities",
            "note": "Taxi from Siam; Yaowarat Road buzzes after 7pm with seafood grills and gold shops",
            "time": "8:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Street Food",
              "Night Market"
            ],
            "category": "other"
          }
        ]
      },
      {
        "date": "2026-12-05",
        "weather": "Comfortable temperatures, 24-31°C",
        "summary": "King Bhumibol Memorial Day celebrations with yellow decorations citywide, temple panoramas, and sky-high views from Mahanakhon's observation deck. 👑🏙️",
        "stops": [
          {
            "name": "Pak Khlong Talat flower market",
            "lat": 13.7416,
            "lng": 100.4948,
            "cost": 10,
            "why": "Early morning market captures local life; yellow flowers abundant for holiday",
            "note": "Open 24hrs but best 6-8am; near Memorial Bridge and Grand Palace area",
            "time": "7:00 AM",
            "durationLabel": "1 hour",
            "tags": [
              "Local Market",
              "Photo Op"
            ],
            "category": "other"
          },
          {
            "name": "Breakfast near flower market",
            "lat": 13.742,
            "lng": 100.495,
            "cost": 12,
            "why": "Old Bangkok area has authentic morning eateries and local atmosphere",
            "note": "Try jok or khao tom (rice soup) at shophouses along Chakraphet Road",
            "time": "8:15 AM",
            "durationLabel": "45 minutes",
            "tags": [
              "Local Pick",
              "Street Food"
            ],
            "category": "food"
          },
          {
            "name": "IconSiam",
            "lat": 13.7268,
            "lng": 100.5105,
            "cost": 57,
            "why": "Luxury mall's SookSiam indoor market showcases Thai crafts and regional specialties",
            "note": "Free shuttle boat from Saphan Taksin BTS; some shops may have holiday hours",
            "time": "9:30 AM",
            "durationLabel": "2 hours",
            "tags": [
              "Shopping",
              "Air-conditioned"
            ],
            "category": "other"
          },
          {
            "name": "Lunch at IconSiam",
            "lat": 13.7268,
            "lng": 100.5105,
            "cost": 20,
            "why": "SookSiam's regional food stalls offer upscale Thai cuisine sampling experience",
            "note": "G floor SookSiam zone; try Pla Pao Talaymuk or Khao Chae seasonal sets",
            "time": "12:00 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Food Court",
              "Thai Cuisine"
            ],
            "category": "food"
          },
          {
            "name": "Wat Saket (Golden Mount)",
            "lat": 13.7537,
            "lng": 100.5063,
            "cost": 3,
            "why": "360-degree city views from historic temple mount; less touristy culture stop",
            "note": "Taxi from IconSiam; 318-step spiral climb with breeze, gold chedi at summit",
            "time": "1:45 PM",
            "durationLabel": "1 hour",
            "tags": [
              "Cultural",
              "Panoramic Views"
            ],
            "category": "entry"
          },
          {
            "name": "King Power Mahanakhon SkyWalk",
            "lat": 13.7244,
            "lng": 100.5398,
            "cost": 28,
            "why": "Thailand's highest observation deck offers dramatic photography opportunities",
            "note": "Book online for discount; glass floor on 78th level, outdoor deck on 74th",
            "time": "3:15 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Must-See",
              "Photo Op"
            ],
            "category": "entry"
          },
          {
            "name": "Dinner in Silom",
            "lat": 13.729,
            "lng": 100.5345,
            "cost": 38,
            "why": "Final evening in central district with quality upscale Thai restaurants",
            "note": "Patpong area has choices; e.g. Baan Khanitha for refined Thai or Somboon Seafood",
            "time": "6:00 PM",
            "durationLabel": "1.5 hours",
            "tags": [
              "Upscale Dining"
            ],
            "category": "food"
          }
        ]
      }
    ]
  },

  "queenstown-couple-noweather": {
    "tier": "midrange",
    "days": [
      {
        "date": "2026-09-26",
        "weather": "Late spring, variable conditions, daytime highs around 12-15°C",
        "summary": "Ease into Otago with peaceful lakeside gardens and private hot pools overlooking the Remarkables. 🌸♨️",
        "lodging": {
          "name": "Boutique hotel in Queenstown",
          "cost": 300,
          "note": "Central yet quiet, easy walk to lake; alternative: luxury lodge for more seclusion"
        },
        "stops": [
          {
            "name": "Queenstown Gardens",
            "lat": -45.0312,
            "lng": 168.6626,
            "cost": 0,
            "why": "Peaceful lakeside botanicals, easy flat paths — nature without the crowds",
            "note": "Go early; loop walk takes 30-45 min, longer if you linger by rose garden",
            "time": "10:00 AM",
            "durationLabel": "1.5 hours",
            "category": "other",
            "tags": [
              "Free",
              "Nature"
            ]
          },
          {
            "name": "Lunch around Queenstown Bay",
            "lat": -45.0312,
            "lng": 168.6626,
            "cost": 60,
            "why": "Waterfront dining with multiple casual-nice options, easy walk from gardens",
            "note": "Try The Bathhouse or lakefront cafés; book ahead for window seats",
            "time": "12:00 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Lake Views"
            ]
          },
          {
            "name": "Onsen Hot Pools",
            "lat": -45.0192,
            "lng": 168.7459,
            "cost": 185,
            "why": "Private cedar tubs with Remarkables views — pure wellness and relaxation",
            "note": "Book the couple's pool for privacy; 90-min sessions, bring swimwear",
            "time": "2:00 PM",
            "durationLabel": "2 hours",
            "category": "entry",
            "tags": [
              "Wellness",
              "Reservation Needed"
            ]
          },
          {
            "name": "Scenic drive to Arrowtown",
            "lat": -44.9383,
            "lng": 168.8278,
            "cost": 0,
            "why": "20-min drive through Shotover Gorge leads to quieter historic village",
            "note": "Peak autumn color is late April, but golden poplars start late September",
            "time": "4:30 PM",
            "durationLabel": "30 minutes",
            "category": "transit",
            "tags": [
              "Scenic Drive"
            ]
          },
          {
            "name": "Arrowtown Historic Walk",
            "lat": -44.9383,
            "lng": 168.8278,
            "cost": 0,
            "why": "Quiet gold-rush town, fewer tourists than Queenstown, charming cottages",
            "note": "Walk Buckingham Street's historic buildings; free and self-guided",
            "time": "5:00 PM",
            "durationLabel": "45 minutes",
            "category": "other",
            "tags": [
              "Free",
              "Local Pick"
            ]
          },
          {
            "name": "Dinner in Arrowtown",
            "lat": -44.9383,
            "lng": 168.8278,
            "cost": 130,
            "why": "Village restaurants feel intimate and local vs. Queenstown bustle",
            "note": "Provisions or Chop Shop for casual-nice; book ahead for weekends",
            "time": "7:00 PM",
            "durationLabel": "1.5 hours",
            "category": "food",
            "tags": [
              "Local Pick"
            ]
          }
        ]
      },
      {
        "date": "2026-09-27",
        "weather": "Cool spring morning, temperatures 8-14°C, possible showers",
        "summary": "Early start to remote Glenorchy's pristine lagoons, then a lakeside walk and afternoon cruise on mirror-calm Lake Wakatipu. 🏔️⛵",
        "lodging": {
          "name": "Boutique hotel in Queenstown",
          "cost": 300,
          "note": "Same base — convenient for Glenorchy day trip; saves check-in time"
        },
        "stops": [
          {
            "name": "Scenic drive to Glenorchy",
            "lat": -44.85,
            "lng": 168.3833,
            "cost": 0,
            "why": "The 'Road to Paradise' — stunning lake and mountains, almost no traffic at dawn",
            "note": "45km scenic route; watch for sheep on road, fuel up in Queenstown first",
            "time": "6:30 AM",
            "durationLabel": "1 hour",
            "category": "transit",
            "tags": [
              "Scenic Drive",
              "Off Peak"
            ]
          },
          {
            "name": "Glenorchy Lagoon Walkway",
            "lat": -44.845,
            "lng": 168.378,
            "cost": 0,
            "why": "Remote wetland with Humboldt and Earnslaw reflections — truly crowd-free",
            "note": "Easy 45-min loop; bring sandfly repellent, especially near lagoon",
            "time": "7:30 AM",
            "durationLabel": "2 hours",
            "category": "other",
            "tags": [
              "Free",
              "Nature"
            ]
          },
          {
            "name": "Coffee in Glenorchy",
            "lat": -44.85,
            "lng": 168.3833,
            "cost": 15,
            "why": "Tiny township, one café — perfect rest stop before return drive",
            "note": "Glenorchy Café does good coffee; extremely limited hours, check ahead",
            "time": "10:00 AM",
            "durationLabel": "30 minutes",
            "category": "food",
            "tags": [
              "Local Pick"
            ]
          },
          {
            "name": "Return drive to Queenstown",
            "lat": -45.0312,
            "lng": 168.6626,
            "cost": 0,
            "why": "Lakeside route with photo stops at Bennett's Bluff and other viewpoints",
            "note": "Allow time for roadside lookouts; viewpoints every few km",
            "time": "10:45 AM",
            "durationLabel": "1.5 hours",
            "category": "transit",
            "tags": [
              "Scenic Drive"
            ]
          },
          {
            "name": "Lunch in Queenstown",
            "lat": -45.0312,
            "lng": 168.6626,
            "cost": 70,
            "why": "Refuel in town center before afternoon lakeside activities",
            "note": "Fergburger is famous but crowded; try Botswana Butchery for quieter spot",
            "time": "12:30 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Local Pick"
            ]
          },
          {
            "name": "Bob's Cove Track",
            "lat": -45.005,
            "lng": 168.5983,
            "cost": 0,
            "why": "Quiet lakeside walk through beech forest — locals' favorite, rarely crowded",
            "note": "20-min drive from town; easy 1-hour walk, peaceful beach at the end",
            "time": "2:00 PM",
            "durationLabel": "1 hour",
            "category": "other",
            "tags": [
              "Free",
              "Nature"
            ]
          },
          {
            "name": "TSS Earnslaw cruise on Lake Wakatipu",
            "lat": -45.0312,
            "lng": 168.6626,
            "cost": 180,
            "why": "Vintage steamship cruise — scenic and leisurely, fits relaxation priority",
            "note": "Book afternoon departure; fewer families than morning sailings",
            "time": "3:30 PM",
            "durationLabel": "2.5 hours",
            "category": "entry",
            "tags": [
              "Scenic",
              "Reservation Needed"
            ]
          },
          {
            "name": "Dinner in Queenstown",
            "lat": -45.0312,
            "lng": 168.6626,
            "cost": 130,
            "why": "Nice restaurant to end active day — waterfront or hill-view dining",
            "note": "Rātā or The Bunker for upscale-casual; reservations essential",
            "time": "6:30 PM",
            "durationLabel": "1.5 hours",
            "category": "food",
            "tags": [
              "Reservation Needed"
            ]
          }
        ]
      },
      {
        "date": "2026-09-28",
        "weather": "Partly cloudy, 10-15°C, occasional light winds",
        "summary": "Traverse the dramatic Crown Range into Wanaka, then unwind with lakeside strolls and local wine tasting. 🍷🏔️",
        "lodging": {
          "name": "Boutique hotel in Wanaka",
          "cost": 280,
          "note": "Lake views, walkable to everything; alternative: apartment for longer stays"
        },
        "stops": [
          {
            "name": "Crown Range Road to Wanaka",
            "lat": -44.8833,
            "lng": 168.9167,
            "cost": 0,
            "why": "New Zealand's highest sealed road — dramatic alpine scenery, photo stops",
            "note": "Check weather before going; conditions can change, allow extra time",
            "time": "9:00 AM",
            "durationLabel": "1.5 hours",
            "category": "transit",
            "tags": [
              "Scenic Drive",
              "Must-See"
            ]
          },
          {
            "name": "Arrive and settle into Wanaka",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 0,
            "why": "Check in to new base — quieter lake town, less commercial than Queenstown",
            "note": "Main street is compact and walkable; hotel likely near lakefront",
            "time": "10:30 AM",
            "durationLabel": "30 minutes",
            "category": "other",
            "tags": [
              "Local Pick"
            ]
          },
          {
            "name": "Lunch in Wanaka",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 65,
            "why": "Relaxed lunch to settle into new town — good local cafés and bistros",
            "note": "Francesca's, Bistro Gentil, or lakefront spots; less busy than Queenstown",
            "time": "12:00 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Local Pick"
            ]
          },
          {
            "name": "Wanaka Lakefront to Eely Point",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 0,
            "why": "Easy flat walk, stunning lake views, almost no crowds — perfect moderate pace",
            "note": "~3km walk from town; willow trees and crystal-clear water",
            "time": "2:00 PM",
            "durationLabel": "1.5 hours",
            "category": "other",
            "tags": [
              "Free",
              "Nature"
            ]
          },
          {
            "name": "Rippon Vineyard",
            "lat": -44.6833,
            "lng": 169.1167,
            "cost": 40,
            "why": "Lakefront winery with mountain backdrop — wine and scenery, quiet tasting room",
            "note": "Open limited hours in spring; tastings ~$15-20pp, check website first",
            "time": "4:00 PM",
            "durationLabel": "1.5 hours",
            "category": "entry",
            "tags": [
              "Local Pick",
              "Scenic"
            ]
          },
          {
            "name": "Rest at hotel",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 0,
            "why": "Downtime before dinner — unpack, relax, enjoy hotel amenities",
            "note": "Boutique hotels often have gardens or lake-view terraces",
            "time": "6:00 PM",
            "durationLabel": "30 minutes",
            "category": "other",
            "tags": [
              "Relaxation"
            ]
          },
          {
            "name": "Dinner in Wanaka",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 120,
            "why": "Local dining scene is excellent and relaxed — farm-to-table focus",
            "note": "Kika, Bistro Gentil, or Francesca's for nice meals; book ahead",
            "time": "7:00 PM",
            "durationLabel": "1.5 hours",
            "category": "food",
            "tags": [
              "Reservation Needed"
            ]
          }
        ]
      },
      {
        "date": "2026-09-29",
        "weather": "Clear morning, 9-16°C, ideal conditions for outdoor activities",
        "summary": "Morning hike to glacial Blue Pools through beech forest, then indulge in a couples spa retreat with alpine views. 💙🧘",
        "lodging": {
          "name": "Boutique hotel in Wanaka",
          "cost": 280,
          "note": "Same base — no repacking, just wellness and nature today"
        },
        "stops": [
          {
            "name": "Helicopter scenic flight over Mount Aspiring",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 450,
            "why": "Ultimate nature experience — glaciers and alpine peaks, weather-dependent thrill",
            "note": "Early flight has clearest conditions; book ahead, flexible cancellation advised",
            "time": "7:00 AM",
            "durationLabel": "30 minutes",
            "category": "entry",
            "tags": [
              "Premium",
              "Reservation Needed"
            ]
          },
          {
            "name": "Drive to Blue Pools Track",
            "lat": -44.4167,
            "lng": 169.2667,
            "cost": 0,
            "why": "Scenic route north toward Mount Aspiring National Park — gateway to wilderness",
            "note": "~45 min drive toward Haast Pass; easy sealed road, stunning scenery",
            "time": "8:00 AM",
            "durationLabel": "45 minutes",
            "category": "transit",
            "tags": [
              "Scenic Drive"
            ]
          },
          {
            "name": "Blue Pools Track",
            "lat": -44.4167,
            "lng": 169.2667,
            "cost": 0,
            "why": "Glacial-fed turquoise pools, swing bridge — moderate walk through beech forest",
            "note": "30-min walk each way; morning has best light and fewest people",
            "time": "9:00 AM",
            "durationLabel": "2 hours",
            "category": "other",
            "tags": [
              "Free",
              "Nature"
            ]
          },
          {
            "name": "Return drive to Wanaka",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 0,
            "why": "Head back for lunch and afternoon wellness activities",
            "note": "Same route; could stop at Makarora Country Café if hungry early",
            "time": "11:15 AM",
            "durationLabel": "45 minutes",
            "category": "transit",
            "tags": [
              "Scenic Drive"
            ]
          },
          {
            "name": "Lunch in Wanaka",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 75,
            "why": "Refuel before spa — good cafés near town center for casual-nice meals",
            "note": "Federal Diner, Relishes, or Ardour for relaxed lunch",
            "time": "12:30 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Local Pick"
            ]
          },
          {
            "name": "Couples spa treatment",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 350,
            "why": "Wellness priority — massage and relaxation with views after morning hike",
            "note": "Lake Spa or similar; book several days ahead, especially in peak season",
            "time": "2:30 PM",
            "durationLabel": "2.5 hours",
            "category": "entry",
            "tags": [
              "Wellness",
              "Reservation Needed"
            ]
          },
          {
            "name": "Wanaka Tree lakeside walk",
            "lat": -44.695,
            "lng": 169.132,
            "cost": 0,
            "why": "Famous willow tree in the lake — short stroll for iconic photo at golden hour",
            "note": "5-min walk from town center; best light late afternoon, usually quiet",
            "time": "5:30 PM",
            "durationLabel": "30 minutes",
            "category": "other",
            "tags": [
              "Free",
              "Scenic"
            ]
          },
          {
            "name": "Dinner in Wanaka",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 140,
            "why": "Celebrate final night — upscale dining with lake or mountain views",
            "note": "Kika or Ripe for fine dining; Alchemy is good mid-range alternative",
            "time": "6:30 PM",
            "durationLabel": "1.5 hours",
            "category": "food",
            "tags": [
              "Reservation Needed"
            ]
          }
        ]
      },
      {
        "date": "2026-09-30",
        "weather": "Crisp spring morning, 8-14°C, light breeze",
        "summary": "Final morning by the lake with a peaceful bay walk before departing Otago refreshed. 🌅",
        "stops": [
          {
            "name": "Glendhu Bay lakeside walk",
            "lat": -44.6833,
            "lng": 169.1667,
            "cost": 0,
            "why": "Peaceful final morning by the lake — easy track, mountain views, very quiet",
            "note": "~15 min drive from town; flat scenic track, rarely crowded even in summer",
            "time": "8:00 AM",
            "durationLabel": "1.5 hours",
            "category": "other",
            "tags": [
              "Free",
              "Nature"
            ]
          },
          {
            "name": "Coffee at Wanaka café",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 15,
            "why": "Final excellent Wanaka coffee before departing — local café culture shines",
            "note": "Pembroke Patisserie or Federal Diner for coffee and pastries",
            "time": "10:00 AM",
            "durationLabel": "30 minutes",
            "category": "food",
            "tags": [
              "Local Pick"
            ]
          },
          {
            "name": "Lunch in Wanaka",
            "lat": -44.7,
            "lng": 169.15,
            "cost": 90,
            "why": "Last meal before heading to Queenstown Airport or onward journey",
            "note": "Allow time for relaxed farewell meal; airport is ~1 hour drive",
            "time": "12:00 PM",
            "durationLabel": "1 hour",
            "category": "food",
            "tags": [
              "Local Pick"
            ]
          }
        ]
      }
    ]
  },
};
