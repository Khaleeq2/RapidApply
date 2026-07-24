import type { BrowserExecutionPlan } from "@rapidapply/contracts";
import searchResultsHtml from "./fixtures/linkedin/search-results.html?raw";
import {
  buildLinkedInSearchUrl,
  createLinkedInDiscoveryState,
  extractLinkedInSearchJobs,
  hydrateLinkedInSearchResults,
  mergeDiscoveredJobs,
} from "../src/adapters/linkedin/search";

const plan: BrowserExecutionPlan = {
  runId: "8fc331d6-5712-4fd1-836a-a3b8e5dc1a9d",
  adapterId: "linkedin",
  targetRole: "Senior Product Designer",
  targetLocation: "New York · Remote",
  targetApplications: 40,
  poolTarget: 48,
  preferences: {
    experience: "senior",
    workStyle: "remote",
    onlyEasyApply: true,
    excludedTerms: ["unpaid"],
  },
};

describe("LinkedIn search preparation", () => {
  it("builds the deterministic filtered search URL used by the executor tab", () => {
    const url = new URL(buildLinkedInSearchUrl(plan, 2));

    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/jobs/search/");
    expect(url.searchParams.get("keywords")).toBe("Senior Product Designer");
    expect(url.searchParams.get("location")).toBe("New York");
    expect(url.searchParams.get("start")).toBe("50");
    expect(url.searchParams.get("f_AL")).toBe("true");
    expect(url.searchParams.get("f_WT")).toBe("2");
  });

  it("retains the legacy 20 percent discovery buffer and one-page hydration margin", () => {
    const discovery = createLinkedInDiscoveryState(plan);
    expect(discovery.poolTarget).toBe(48);
    expect(discovery.maxPages).toBe(3);
    expect(discovery.pageIndex).toBe(0);
  });

  it("extracts canonical job identities through card and link fallbacks without duplicates", () => {
    render(searchResultsHtml);
    const jobs = extractLinkedInSearchJobs(
      document,
      new URL("https://www.linkedin.com/jobs/search/?keywords=designer"),
    );

    expect(jobs).toEqual([
      {
        externalId: "10001",
        url: "https://www.linkedin.com/jobs/view/10001/",
        title: "Product Designer",
        company: "Fixture Labs",
        location: "New York, NY · Remote",
      },
      {
        externalId: "10002",
        url: "https://www.linkedin.com/jobs/view/10002/",
        title: "Senior Product Designer",
        company: "Example Studio",
        location: "Remote",
      },
      {
        externalId: "10003",
        url: "https://www.linkedin.com/jobs/view/10003/",
        title: "Fallback Product Designer",
      },
    ]);
  });

  it("keeps richer existing metadata while merging replayed discovery results", () => {
    const merged = mergeDiscoveredJobs(
      [{
        externalId: "10001",
        url: "https://www.linkedin.com/jobs/view/10001/",
        title: "Product Designer",
        company: "Fixture Labs",
      }],
      [{
        externalId: "10001",
        url: "https://www.linkedin.com/jobs/view/10001/",
        location: "Remote",
      }],
    );

    expect(merged).toEqual([{
      externalId: "10001",
      url: "https://www.linkedin.com/jobs/view/10001/",
      title: "Product Designer",
      company: "Fixture Labs",
      location: "Remote",
    }]);
  });

  it("retains links seen before a virtualized result card is replaced", async () => {
    render(`
      <ul class="jobs-search-results__list">
        <li class="jobs-search-results__list-item" data-occludable-job-id="10001">
          <a href="/jobs/view/10001/">First role</a>
        </li>
      </ul>
    `);
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.occludableJobId !== "10001") return;
        document.querySelector("ul")!.innerHTML = `
          <li class="jobs-search-results__list-item" data-occludable-job-id="10002">
            <a href="/jobs/view/10002/">Second role</a>
          </li>
        `;
      });

    const result = await hydrateLinkedInSearchResults(
      document,
      new URL("https://www.linkedin.com/jobs/search/"),
      { maxCycles: 3, settleMs: 1, stableCycles: 1 },
    );

    expect(result.jobs.map((job) => job.externalId)).toEqual(["10001", "10002"]);
    scroll.mockRestore();
  });
});

function render(html: string): void {
  document.open();
  document.write(html);
  document.close();
}
