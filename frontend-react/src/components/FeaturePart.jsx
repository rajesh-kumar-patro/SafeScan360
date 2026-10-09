import React from "react";
import {
  ShieldCheck,
  Video,
  UserCheck,
  HardHat,
  Hand,
  Footprints,
  Siren
} from "lucide-react";

export default function FeaturePart() {
  const features = [
    {
      icon: UserCheck,
      title: "Face Verification",
      description:
        "Instantly verify registered workers using AI-powered facial recognition before safety inspection begins.",
      color: "blue",
    },
    {
      icon: ShieldCheck,
      title: "PPE Detection",
      description:
        "Automatically detect helmet, safety vest, gloves, and safety shoes in real time.",
      color: "cyan",
    },
    {
      icon: Video,
      title: "Real-Time Monitoring",
      description:
        "Monitor live camera streams and identify safety compliance issues with fast AI processing.",
      color: "indigo",
    },
    {
      icon: HardHat,
      title: "Helmet and Vest Detection",
      description:
        "Detect whether workers are wearing the required safety helmet and vest before entering the work zone.",
      color: "sky",
    },
    {
      icon: Hand,
      title: "Gloves and Boots Detection",
      description:
        "Verify required hand and Boots protection and immediately identify missing safety gear.",
      color: "blue",
    },
    {
      icon: Siren,
      title: "Safety Alerts",
      description:
        "Generate instant visual and audio alerts when PPE violations or hazards are detected.",
      color: "red",
    },
  ];

  return (
    <section
      id="features"
      className="py-20 bg-slate-50 border-y border-slate-200"
    >
      <div className="max-w-7xl mx-auto px-6">

        {/* HEADER */}
        <div className="text-center max-w-2xl mx-auto mb-12">


          <h3 className="text-3xl md:text-4xl font-extrabold text-slate-900">
             Safety Features
          </h3>

          <p className="mt-3 text-sm md:text-base text-slate-500">
            Smart AI technology designed to verify workers, detect PPE,
            monitor safety compliance, and respond to workplace hazards.
          </p>

        </div>

        {/* FEATURE CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">

          {features.map((feature, index) => {
            const Icon = feature.icon;

            return (
              <div
                key={index}
                className="group relative p-6 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
              >

                {/* TOP ACCENT */}
                <div className="absolute top-0 left-6 right-6 h-[2px] bg-gradient-to-r from-blue-500 to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity" />

                {/* ICON */}
                <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
                  <Icon size={22} />
                </div>

                {/* CONTENT */}
                <div className="mt-5">

                  <h4 className="text-lg font-bold text-slate-900">
                    {feature.title}
                  </h4>

                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {feature.description}
                  </p>

                </div>

                {/* BOTTOM ARROW */}
                <div className="mt-5 text-xs font-semibold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Learn more →
                </div>

              </div>
            );
          })}

        </div>

      </div>
    </section>
  );
}