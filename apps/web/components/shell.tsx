"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CURRENT_MILESTONE, SECTIONS } from "@ewm/shared";
import { useSession } from "@/lib/session";

export function Shell({ children }: { children: ReactNode }) {
  const { user, projects, project, selectProject, signOut } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}>
        <div className="sidebar__top">
          <Link href="/dashboard" className="sidebar__brand">
            EWM Agent
          </Link>
          <button
            className="sidebar__toggle"
            aria-expanded={menuOpen}
            aria-controls="console-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            Menu
          </button>
        </div>

        <div className="sidebar__body" id="console-nav">
          <label className="project-switch">
            <span>Project</span>
            {projects.length > 0 ? (
              <select value={project?.id ?? ""} onChange={(e) => selectProject(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key} {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <em>None yet</em>
            )}
          </label>

          <nav aria-label="Sections">
            <ul>
              {SECTIONS.map((section) => {
                const href = `/${section.slug}`;
                const active = pathname === href || pathname.startsWith(`${href}/`);
                const live = section.liveFrom <= CURRENT_MILESTONE;
                return (
                  <li key={section.slug}>
                    <Link
                      href={href}
                      className={`nav-link ${active ? "nav-link--active" : ""} ${live ? "" : "nav-link--later"}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <span>{section.label}</span>
                      {live ? null : (
                        <span
                          className="nav-link__later"
                          title={`Arrives with Milestone ${section.liveFrom}`}
                        >
                          M{section.liveFrom}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="sidebar__account">
            <p className="sidebar__user">{user.name}</p>
            <p className="sidebar__email">{user.email}</p>
            <div className="sidebar__links">
              {user.isOrgAdmin ? (
                <Link href="/users" aria-current={pathname === "/users" ? "page" : undefined}>
                  Users
                </Link>
              ) : null}
              <Link href="/account" aria-current={pathname === "/account" ? "page" : undefined}>
                Password
              </Link>
              <button onClick={() => void signOut()}>Sign out</button>
            </div>
          </div>
        </div>
      </aside>

      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}
