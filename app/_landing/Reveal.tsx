"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Scroll reveal + the pipeline pulse. Both are motion, so both are disabled
// outright when the visitor asks for reduced motion — no transform, no timer.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return setShown(true);
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && setShown(true)),
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: reduced ? undefined : `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

const STAGES = ["DISCOVER", "ENRICH", "RESEARCH", "APPROVE", "OUTREACH", "REPLIES", "CLOSE"] as const;
const GATE_INDEX = 3;

export function PipelineRail() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setActive((value) => (value + 1) % STAGES.length), 1400);
    return () => clearInterval(timer);
  }, [reduced]);

  return (
    <div className="w-full overflow-x-auto">
      <ol className="flex min-w-max items-stretch gap-2 sm:gap-3" aria-label="Pipeline stages">
        {STAGES.map((stage, index) => {
          const live = !reduced && index === active;
          const gate = index === GATE_INDEX;
          return (
            <li key={stage} className="flex items-center gap-2 sm:gap-3">
              <div
                className={`rounded-lg border px-3 py-2.5 font-mono text-[11px] tracking-[0.14em] transition-colors duration-500 sm:px-4 sm:text-xs ${
                  gate
                    ? "border-[#8A6516]/35 bg-[#8A6516]/10 text-[#8A6516]"
                    : live
                      ? "border-[#125740] bg-[#125740]/10 text-[#0E7A45]"
                      : "border-[#125740]/30/15 bg-white text-[#4F6058]"
                }`}
              >
                {stage}
                {gate && <span className="ml-2 text-[9px] opacity-80">GATE</span>}
              </div>
              {index < STAGES.length - 1 && (
                <span aria-hidden className={`h-px w-4 sm:w-7 ${live ? "bg-[#125740]" : "bg-[#125740]/60"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
