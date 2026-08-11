import { Trip } from "./types";

/**
 * Hardcoded trip for visually inspecting /trip/[id] without a real generation
 * round-trip. Lives in its own module and is loaded with a dynamic `import()` so
 * these 50-odd lines of fixture stay out of the route's client bundle for the
 * people looking at their actual trips.
 */
export const PREVIEW_TRIP: Trip = {
  id: "preview",
  destination: "Paris, France",
  startDate: "2026-09-01",
  endDate: "2026-09-03",
  budget: 1200,
  itinerary: {
    tier: "midrange",
    days: [
      {
        date: "2026-09-01",
        weather: "Pleasant and mild, 13.6-21°C, ideal for sightseeing",
        lodging: { name: "Hotel Pulitzer Paris", cost: 160, note: "Boutique 4-star hotel in Le Marais district" },
        stops: [
          { name: "CDG Airport to Hotel Transfer", lat: 48.8566, lng: 2.3642, cost: 45, note: "Private taxi to Le Marais", time: "9:00 AM", durationLabel: "45 minutes", tags: ["Transportation", "Arrival"], category: "transit" },
          { name: "Breakfast at Hotel Café", lat: 48.8566, lng: 2.3642, cost: 18, note: "Pastries, croissants, and fresh coffee", time: "9:45 AM", durationLabel: "30 minutes", tags: ["Casual", "Hotel"], category: "food" },
          { name: "Île de la Cité & Notre-Dame", lat: 48.853, lng: 2.3499, cost: 0, note: "Walk around iconic cathedral and island", time: "10:15 AM", durationLabel: "1 hour", tags: ["Must-See", "Free"], category: "other" },
          { name: "Lunch at Bistro Paul Bert", lat: 48.853, lng: 2.345, cost: 35, note: "Classic French bistro with traditional cuisine", time: "11:15 AM", durationLabel: "1.5 hours", tags: ["Local", "Michelin-Recommended"], category: "food" },
          { name: "Musée d'Orsay with Private Guide", lat: 48.8601, lng: 2.3265, cost: 80, note: "Impressionist masterpieces with expert commentary", time: "12:45 PM", durationLabel: "3 hours", tags: ["Museum", "Premium"], category: "entry" },
          { name: "Afternoon Café Break", lat: 48.8601, lng: 2.33, cost: 12, note: "Coffee and pastry rest stop", time: "3:45 PM", durationLabel: "30 minutes", tags: ["Casual", "Break"], category: "food" },
          { name: "Le Marais Boutique Shopping", lat: 48.8566, lng: 2.3642, cost: 60, note: "Curated vintage and designer boutiques", time: "4:15 PM", durationLabel: "1.5 hours", tags: ["Shopping", "Local"], category: "other" },
          { name: "Dinner at Le Petit Pontoise", lat: 48.8566, lng: 2.352, cost: 45, note: "Classic Parisian bistro with charming ambiance", time: "6:00 PM", durationLabel: "1.5 hours", tags: ["Dinner", "Local"], category: "food" },
        ],
      },
      {
        date: "2026-09-02",
        weather: "Cooler day, 12.2-18.3°C, perfect for museums and indoor activities",
        lodging: { name: "Hotel Pulitzer Paris", cost: 160, note: "Second night at same boutique hotel" },
        stops: [
          { name: "Breakfast at Local Café", lat: 48.8566, lng: 2.3642, cost: 12, note: "Croissants and café au lait", time: "9:00 AM", durationLabel: "30 minutes", tags: ["Casual", "Local"], category: "food" },
          { name: "Louvre Museum", lat: 48.8606, lng: 2.3376, cost: 22, note: "World's largest art museum, iconic masterpieces", time: "9:30 AM", durationLabel: "3 hours", tags: ["Museum", "Must-See"], category: "entry" },
          { name: "Lunch near Louvre", lat: 48.8606, lng: 2.3376, cost: 28, note: "Quick casual bistro lunch", time: "12:30 PM", durationLabel: "1 hour", tags: ["Convenient", "Casual"], category: "food" },
          { name: "Sainte-Chapelle", lat: 48.8509, lng: 2.3475, cost: 15, note: "Stunning stained glass windows and Gothic architecture", time: "1:30 PM", durationLabel: "1.5 hours", tags: ["Historic", "Must-See"], category: "entry" },
          { name: "Afternoon Café Break", lat: 48.8509, lng: 2.3475, cost: 12, note: "Rest with coffee and pastry", time: "3:00 PM", durationLabel: "30 minutes", tags: ["Casual", "Break"], category: "food" },
          { name: "French Cooking Class", lat: 48.8566, lng: 2.352, cost: 95, note: "Market-to-table cooking experience with local ingredients", time: "3:30 PM", durationLabel: "2.5 hours", tags: ["Experience", "Premium"], category: "entry" },
          { name: "Dinner at Cooking Class Venue", lat: 48.8566, lng: 2.352, cost: 60, note: "Enjoy prepared dishes with wine pairing", time: "6:00 PM", durationLabel: "1.5 hours", tags: ["Dinner", "Included"], category: "food" },
        ],
      },
      {
        date: "2026-09-03",
        weather: "Beautiful day, 16.1-25.1°C, excellent for outdoor sightseeing",
        stops: [
          { name: "Breakfast at Local Café", lat: 48.8566, lng: 2.3642, cost: 12, note: "Final morning pastry and coffee", time: "9:00 AM", durationLabel: "30 minutes", tags: ["Casual", "Local"], category: "food" },
          { name: "Eiffel Tower Fast-Track Entry", lat: 48.8584, lng: 2.2945, cost: 35, note: "Skip-the-line access with summit views", time: "9:30 AM", durationLabel: "2.5 hours", tags: ["Must-See", "Premium"], category: "entry" },
          { name: "Lunch near Eiffel Tower", lat: 48.8584, lng: 2.2945, cost: 30, note: "Casual lunch with tower views", time: "12:00 PM", durationLabel: "1 hour", tags: ["Views", "Casual"], category: "food" },
          { name: "Seine River Walk & Shopping", lat: 48.8566, lng: 2.2922, cost: 40, note: "Stroll along the Seine, browse riverside boutiques", time: "1:00 PM", durationLabel: "2 hours", tags: ["Romantic", "Shopping"], category: "other" },
          { name: "Afternoon Café", lat: 48.8699, lng: 2.3073, cost: 15, note: "Rest and refreshments", time: "3:00 PM", durationLabel: "30 minutes", tags: ["Casual", "Break"], category: "food" },
          { name: "Arc de Triomphe", lat: 48.8738, lng: 2.295, cost: 18, note: "Iconic monument with rooftop city views", time: "3:30 PM", durationLabel: "1.5 hours", tags: ["Must-See", "Views"], category: "entry" },
          { name: "Champs-Élysées Shopping", lat: 48.8699, lng: 2.3073, cost: 60, note: "Luxury shopping on world's most famous avenue", time: "5:00 PM", durationLabel: "2 hours", tags: ["Shopping", "Luxury"], category: "other" },
          { name: "Seine Dinner Cruise", lat: 48.8566, lng: 2.2922, cost: 95, note: "3-course gourmet dinner with illuminated city views", time: "7:00 PM", durationLabel: "3 hours", tags: ["Romantic", "Premium"], category: "food" },
        ],
      },
    ],
  },
};
