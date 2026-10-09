import React from "react";
import {
  UserPlus,
  ScanFace,
  UserCheck,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

export default function WorkingPart() {
  const steps = [
    {
      number: "01",
      icon: UserPlus,
      title: "Register Worker",
      description:
        "Supervisor registers the worker with name, mobile number, face image, and face embedding.",
    },
    {
      number: "02",
      icon: ScanFace,
      title: "Detect Face",
      description:
        "When a worker arrives, the camera automatically detects and scans the person's face.",
    },
    {
      number: "03",
      icon: UserCheck,
      title: "Verify Identity",
      description:
        "The detected face is matched with registered workers and verified instantly.",
    },
    {
      number: "04",
      icon: ShieldCheck,
      title: "Check PPE",
      description:
        "After verification, AI checks helmet, safety vest, gloves, and safety shoes.",
    },
    {
      number: "05",
      icon: AlertTriangle,
      title: "Safety Decision",
      description:
        "The system identifies whether the worker is fully compliant or missing required PPE.",
    },
    {
      number: "06",
      icon: CheckCircle2,
      title: "Alert & Record",
      description:
        "Safe workers are approved while violations trigger alerts and are recorded for monitoring.",
    },
  ];

  return (
    <section
      id="how-it-works"
      className="py-20 bg-white border-y border-slate-200"
    >
      <div className="max-w-7xl mx-auto px-6">

        {/* HEADER */}
        <div className="text-center max-w-2xl mx-auto mb-14">


          <h3 className="text-3xl md:text-4xl font-extrabold text-slate-900">
            How SafeScan360 Works
          </h3>

          <p className="mt-3 text-sm md:text-base text-slate-500 leading-relaxed">
            From worker registration to real-time PPE verification,
            SafeScan360 automatically checks identity, safety equipment,
            and compliance before allowing the worker to proceed.
          </p>

        </div>

        {/* WORKFLOW */}
        <div className="relative">

          {/* CONNECTING LINE - DESKTOP */}
          <div className="hidden lg:block absolute top-[58px] left-[8%] right-[8%] h-px bg-gradient-to-r from-blue-200 via-blue-400 to-cyan-200" />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-5">

            {steps.map((step, index) => {
              const Icon = step.icon;

              return (
                <div
                  key={step.number}
                  className="relative group"
                >

                  {/* CARD */}
                  <div className="relative h-full bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">

                    {/* NUMBER + ICON */}
                    <div className="relative flex items-center justify-between mb-5">

                      <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
                        <Icon size={21} />
                      </div>

                      <span className="text-xs font-black text-slate-300">
                        {step.number}
                      </span>

                    </div>

                    {/* TITLE */}
                    <h4 className="text-base font-bold text-slate-900">
                      {step.title}
                    </h4>

                    {/* DESCRIPTION */}
                    <p className="mt-2 text-xs text-slate-500 leading-5">
                      {step.description}
                    </p>

                  </div>

                  {/* ARROW */}
                  {index < steps.length - 1 && (
                    <div className="hidden lg:flex absolute -right-4 top-[50px] z-10 w-8 h-8 rounded-full bg-white border border-blue-100 items-center justify-center text-blue-500 shadow-sm">
                      <ArrowRight size={14} />
                    </div>
                  )}

                </div>
              );
            })}

          </div>
        </div>

        {/* FINAL STATUS */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* VERIFIED */}
          <div className="flex items-center gap-4 rounded-2xl bg-emerald-50 border border-emerald-100 p-5">

            <div className="w-11 h-11 shrink-0 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
              <CheckCircle2 size={23} />
            </div>

            <div>
              <h4 className="font-bold text-emerald-900">
                Fully Compliant
              </h4>

              <p className="text-xs text-emerald-700 mt-1">
                Face verified + Helmet + Vest + Gloves + Shoes detected
              </p>
            </div>

          </div>

          {/* VIOLATION */}
          <div className="flex items-center gap-4 rounded-2xl bg-red-50 border border-red-100 p-5">

            <div className="w-11 h-11 shrink-0 rounded-xl bg-red-100 flex items-center justify-center text-red-600">
              <AlertTriangle size={23} />
            </div>

            <div>
              <h4 className="font-bold text-red-900">
                PPE Violation
              </h4>

              <p className="text-xs text-red-700 mt-1">
                Missing PPE detected → Instant warning + safety alert
              </p>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}