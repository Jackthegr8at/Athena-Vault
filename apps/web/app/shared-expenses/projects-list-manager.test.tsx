// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { click, createDomTestRoot } from "../../test/dom";

const mocks = vi.hoisted(() => ({
  createProjectAction: vi.fn(async () => ({ ok: false, message: "", fieldErrors: {} })),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: vi.fn(() => ({ push: mocks.push })) }));
vi.mock("./actions", () => ({ createProjectAction: mocks.createProjectAction }));

import { ProjectsListManager } from "./projects-list-manager";

const projects = [{
  id: "project-1",
  name: "Cabin weekend",
  projectYear: 2026,
  ownerParticipates: true,
  note: "Friends trip",
  archived: false,
  totalExpensesMinor: 12_000,
  receivedFromOthersMinor: 6_000,
  outstandingMinor: 2_000,
  participantCount: 3,
  collectionStatus: "partial" as const,
}];

const dom = createDomTestRoot();

describe("Projects list manager", () => {
  it("renders the compact filters, status navigation, and project summary", async () => {
    await dom.render(React.createElement(ProjectsListManager, {
      projects,
      totalProjectCount: 1,
      years: [2026, 2025],
      selectedYear: 2026,
      status: "active",
      currentYear: 2026,
    }));

    expect(dom.get(".projects-list-header").textContent).toContain("Shared expense history");
    expect(dom.get(".projects-list-count").textContent).toContain("1");
    expect(dom.get(".projects-year-filter").textContent).toContain("Year");
    expect(dom.get('[aria-label="Shared expense status filter"]').querySelector("a.is-active")?.textContent).toBe("Active");
    expect(dom.get('[aria-label="Shared expense status filter"] a.is-active').getAttribute("href")).toContain("year=2026");
    expect(dom.container.textContent).toContain("Cabin weekend");
    expect(dom.container.textContent).toContain("$120.00");
    expect(dom.container.textContent).toContain("Partial");
    expect(dom.container.querySelector(".animated-line-background--projects-header")).not.toBeNull();
  });

  it("opens the create form with scoped feedback fields and accessible state", async () => {
    await dom.render(React.createElement(ProjectsListManager, {
      projects,
      totalProjectCount: 1,
      years: [2026],
      selectedYear: null,
      status: "all",
      currentYear: 2026,
    }));

    const toggle = dom.get<HTMLButtonElement>("button.project-primary-button");
    expect(toggle.textContent).toContain("New shared expense");
    await click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(dom.get(".project-new-panel").textContent).toContain("Create a shared expense");
    expect(dom.get<HTMLInputElement>('input[name="name"]').required).toBe(true);
    expect(dom.get<HTMLInputElement>('input[name="year"]').value).toBe("2026");
    expect(dom.get<HTMLInputElement>('input[name="ownerParticipates"]').type).toBe("checkbox");
    expect(dom.get<HTMLTextAreaElement>('textarea[name="projectNote"]')).not.toBeNull();
    expect(dom.get<HTMLButtonElement>('button[type="submit"]')?.textContent).toContain("Create shared expense");
  });
});
