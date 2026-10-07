"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "./api";
import type { ProjectListItem, User } from "./types";

interface Session {
  user: User;
  projects: ProjectListItem[];
  /** The project the Dashboard, SAP Systems, Tickets and Audit Logs sections are showing. */
  project: ProjectListItem | null;
  selectProject: (id: string) => void;
  reloadProjects: () => Promise<ProjectListItem[]>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);
const STORAGE_KEY = "ewm.project";

function remembered(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const reloadProjects = useCallback(async () => {
    const { projects } = await api<{ projects: ProjectListItem[] }>("/projects");
    setProjects(projects);
    return projects;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ user }, { projects }] = await Promise.all([
          api<{ user: User }>("/auth/me"),
          api<{ projects: ProjectListItem[] }>("/projects"),
        ]);
        if (cancelled) return;
        setUser(user);
        setProjects(projects);
        const saved = remembered();
        setProjectId(projects.find((p) => p.id === saved)?.id ?? projects[0]?.id ?? null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        } else {
          setFailure(err instanceof Error ? err.message : "The console could not load.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once when the console opens; router and pathname are read at that moment only.
  }, []);

  const selectProject = useCallback((id: string) => {
    setProjectId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Private browsing: the choice simply lasts for this visit.
    }
  }, []);

  const signOut = useCallback(async () => {
    await api("/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    router.replace("/login");
  }, [router]);

  const value = useMemo<Session | null>(() => {
    if (!user) return null;
    const project = projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
    return { user, projects, project, selectProject, reloadProjects, signOut };
  }, [user, projects, projectId, selectProject, reloadProjects, signOut]);

  if (failure) {
    return (
      <div className="boot">
        <p className="boot__title">The console could not load</p>
        <p>{failure}</p>
        <button className="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
  if (!value) return <div className="boot" aria-busy="true" />;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside the console layout");
  return session;
}
