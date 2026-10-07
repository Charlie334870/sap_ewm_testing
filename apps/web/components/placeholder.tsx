"use client";

import { SECTIONS } from "@ewm/shared";
import { Empty, PageHeader } from "./ui";

/** A section that is part of the design but not built yet. Says what it will do and when. */
export function ComingSection({ slug }: { slug: string }) {
  const section = SECTIONS.find((s) => s.slug === slug)!;
  return (
    <>
      <PageHeader title={section.label} />
      <Empty title={`Arrives with Milestone ${section.liveFrom}`}>
        <p>{section.purpose}</p>
        <p>Nothing is collected or shown here yet.</p>
      </Empty>
    </>
  );
}
