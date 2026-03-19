import Link from "next/link"
import { CalendarDays, Star, DollarSign, Share2, Plane, MapPin, Clock, Users } from "lucide-react"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <img src="/jp-icon.png" alt="JourneyPerfect" className="w-8 h-8" />
          <span className="font-semibold text-gray-900">JourneyPerfect</span>
        </div>
        <Link
          href="/login"
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Get started free
        </Link>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-16 pb-24 max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium mb-6">
          ✈️ Your complete vacation planning companion
        </div>
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 leading-tight mb-6">
          Plan perfect vacations.{" "}
          <span className="text-indigo-600">Live inside one app.</span>
        </h1>
        <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto leading-relaxed">
          Stop juggling airline apps, notes, maps, and email. JourneyPerfect brings your flights, hotels,
          activities, budget, and itinerary into one beautifully organized place.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/login"
            className="px-8 py-3.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors text-lg"
          >
            Start planning for free
          </Link>
          <Link
            href="#features"
            className="px-8 py-3.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors text-lg"
          >
            See how it works
          </Link>
        </div>
      </section>

      {/* Feature grid */}
      <section id="features" className="px-6 py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-4">
            Everything your trip needs
          </h2>
          <p className="text-gray-600 text-center mb-16 max-w-2xl mx-auto">
            From first planning session to last day of vacation, JourneyPerfect keeps everything in sync.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: CalendarDays,
                title: "Smart Itinerary",
                desc: "Day-by-day timeline with automatic travel time calculation, conflict detection, and drag-and-drop scheduling.",
                colorClass: "bg-indigo-50",
                iconColorClass: "text-indigo-600",
              },
              {
                icon: Plane,
                title: "Flight Import",
                desc: "Paste any flight confirmation email and watch JourneyPerfect automatically parse it into structured itinerary events.",
                colorClass: "bg-blue-50",
                iconColorClass: "text-blue-600",
              },
              {
                icon: Star,
                title: "Activity Wishlist",
                desc: "Search Google Places, save activities with hours, costs, and photos. Let the optimizer choose the best fit.",
                colorClass: "bg-yellow-50",
                iconColorClass: "text-yellow-600",
              },
              {
                icon: DollarSign,
                title: "Budget Tracking",
                desc: "Track estimated and actual spend by category. Get alerted when your itinerary is drifting over budget.",
                colorClass: "bg-green-50",
                iconColorClass: "text-green-600",
              },
              {
                icon: MapPin,
                title: "Travel Optimizer",
                desc: "Automatically cluster activities by location, minimize travel time, and build a realistic daily schedule.",
                colorClass: "bg-red-50",
                iconColorClass: "text-red-600",
              },
              {
                icon: Share2,
                title: "Share Your Trip",
                desc: "Generate a beautiful shareable link for friends and family to view your complete trip plan.",
                colorClass: "bg-purple-50",
                iconColorClass: "text-purple-600",
              },
              {
                icon: Clock,
                title: "Live Trip Mode",
                desc: "During travel, see exactly what's next, how long to get there, and where you need to be.",
                colorClass: "bg-orange-50",
                iconColorClass: "text-orange-600",
              },
              {
                icon: Users,
                title: "Group Travel",
                desc: "Add travelers with ages for automatic pricing calculations and activity age-appropriateness filtering.",
                colorClass: "bg-teal-50",
                iconColorClass: "text-teal-600",
              },
            ].map((feature) => (
              <div key={feature.title} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                <div className={`w-10 h-10 rounded-xl ${feature.colorClass} flex items-center justify-center mb-4`}>
                  <feature.icon className={`w-5 h-5 ${feature.iconColorClass}`} />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Ready to plan your next trip?
          </h2>
          <p className="text-gray-600 mb-8">
            Free to get started. No credit card required.
          </p>
          <Link
            href="/login"
            className="inline-block px-10 py-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors text-lg"
          >
            Create your first trip →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-6 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <img src="/jp-icon.png" alt="JourneyPerfect" className="w-5 h-5" />
            JourneyPerfect · Plan perfect vacations
          </div>
          <p className="text-gray-400 text-sm">© {new Date().getFullYear()} JourneyPerfect</p>
        </div>
      </footer>
    </div>
  )
}
