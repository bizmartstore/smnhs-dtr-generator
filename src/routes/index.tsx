import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Trash2, Printer, FileDown, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

import { useDtrStore } from "@/lib/dtr-store";
import {
  MONTHS,
  buildMonthRecords,
  parseRawLogs,
  type Employee,
  type DayRecord,
} from "@/lib/dtr";
import { DtrSheet } from "@/components/dtr/DtrSheet";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DTR Generator — Civil Service Form No. 48" },
      {
        name: "description",
        content:
          "Generate Daily Time Records from raw biometric logs. Print 3 DTRs per A4 landscape page.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [monthIndex0, setMonthIndex0] = useState<number>(now.getMonth());
  const [selectedEmp, setSelectedEmp] = useState<string>("");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster />
      <header className="border-b no-print">
        <div className="container mx-auto px-3 sm:px-4 py-3 sm:py-6">
          <h1 className="text-lg sm:text-2xl font-bold">DTR Generator</h1>
          <p className="text-[11px] sm:text-sm text-muted-foreground leading-snug">
            Civil Service Form No. 48 · Build DTRs from raw biometric logs ·
            Print 3 per A4 landscape page
          </p>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 py-3 sm:py-6 space-y-4 sm:space-y-6">
        <Tabs defaultValue="employees" className="no-print">
          <TabsList className="w-full grid grid-cols-3 h-auto">
            <TabsTrigger value="employees" className="text-xs sm:text-sm py-2">Employees</TabsTrigger>
            <TabsTrigger value="logs" className="text-xs sm:text-sm py-2">Raw Logs</TabsTrigger>
            <TabsTrigger value="dtr" className="text-xs sm:text-sm py-2">Generate DTR</TabsTrigger>
          </TabsList>

          <TabsContent value="employees" className="mt-4">
            <EmployeesPanel />
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <LogsPanel />
          </TabsContent>

          <TabsContent value="dtr" className="mt-4">
            <DtrPanel
              year={year}
              monthIndex0={monthIndex0}
              selectedEmp={selectedEmp}
              setYear={setYear}
              setMonthIndex0={setMonthIndex0}
              setSelectedEmp={setSelectedEmp}
            />
          </TabsContent>
        </Tabs>

        {/* Print area - rendered when an employee is selected on DTR tab */}
        <PrintArea
          year={year}
          monthIndex0={monthIndex0}
          selectedEmp={selectedEmp}
        />
      </main>
    </div>
  );
}

function BatchEmployeesPanel() {
  const store = useDtrStore();
  const [text, setText] = useState("");
  const [amA, setAmA] = useState("08:30");
  const [amD, setAmD] = useState("");
  const [pmA, setPmA] = useState("");
  const [pmD, setPmD] = useState("17:30");

  const importBatch = () => {
    const lines = text.split(/\r?\n/);
    const existing = new Set(store.state.employees.map((e) => e.empNo));
    const toAdd: Employee[] = [];
    let skipped = 0;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      // Accept "empNo, name" or "empNo<TAB>name" or "empNo  name"
      const m = line.match(/^(\S+)[,\t\s]+(.+)$/);
      if (!m) { skipped++; continue; }
      const empNo = m[1].trim();
      const name = m[2].trim();
      if (!empNo || !name) { skipped++; continue; }
      if (existing.has(empNo) || toAdd.some((e) => e.empNo === empNo)) {
        skipped++;
        continue;
      }
      toAdd.push({
        empNo,
        name,
        officialAmArrival: amA || undefined,
        officialAmDeparture: amD || undefined,
        officialPmArrival: pmA || undefined,
        officialPmDeparture: pmD || undefined,
      });
    }
    if (toAdd.length === 0) {
      toast.error("No new employees parsed");
      return;
    }
    for (const e of toAdd) void store.addEmployee(e);
    toast.success(
      `Added ${toAdd.length} employee${toAdd.length === 1 ? "" : "s"}` +
        (skipped ? ` · ${skipped} skipped (duplicate/invalid)` : "")
    );
    setText("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Batch add employees</CardTitle>
        <CardDescription>
          One per line: <code>EmpNo, Name</code> (comma, tab, or spaces). Default
          official hours below are applied to every new employee.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`1, JOEY ALBERT L. AGNAS\n2, MARIA C. SANTOS\n3, JUAN D. DELA CRUZ`}
          className="font-mono text-xs"
        />
        <div className="grid grid-cols-4 gap-2">
          <div>
            <Label>AM Arr.</Label>
            <Input type="time" value={amA} onChange={(e) => setAmA(e.target.value)} />
          </div>
          <div>
            <Label>AM Dep.</Label>
            <Input type="time" value={amD} onChange={(e) => setAmD(e.target.value)} />
          </div>
          <div>
            <Label>PM Arr.</Label>
            <Input type="time" value={pmA} onChange={(e) => setPmA(e.target.value)} />
          </div>
          <div>
            <Label>PM Dep.</Label>
            <Input type="time" value={pmD} onChange={(e) => setPmD(e.target.value)} />
          </div>
        </div>
        <Button onClick={importBatch} className="w-full">Import employees</Button>
      </CardContent>
    </Card>
  );
}

function EmployeesPanel() {
  const store = useDtrStore();
  const [draft, setDraft] = useState<Employee>({
    empNo: "",
    name: "",
    officialAmArrival: "08:30",
    officialAmDeparture: "",
    officialPmArrival: "",
    officialPmDeparture: "17:30",
  });

  const submit = () => {
    if (!draft.empNo.trim() || !draft.name.trim()) {
      toast.error("Employee No. and Name are required");
      return;
    }
    if (store.state.employees.some((e) => e.empNo === draft.empNo.trim())) {
      toast.error("Employee No. already exists");
      return;
    }
    store.addEmployee({
      ...draft,
      empNo: draft.empNo.trim(),
      name: draft.name.trim(),
    });
    setDraft({
      empNo: "",
      name: "",
      officialAmArrival: "08:30",
      officialAmDeparture: "",
      officialPmArrival: "",
      officialPmDeparture: "17:30",
    });
    toast.success("Employee added");
  };

  return (
    <div className="space-y-6">
    <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
      <Card>
        <CardHeader>
          <CardTitle>Add employee</CardTitle>
          <CardDescription>
            All four official times are optional. Provide at least two (typically
            AM arrival &amp; PM departure).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Employee No.</Label>
            <Input
              value={draft.empNo}
              onChange={(e) => setDraft({ ...draft, empNo: e.target.value })}
              placeholder="e.g. 1"
            />
          </div>
          <div>
            <Label>Name</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="JOEY ALBERT L. AGNAS"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Official AM Arrival</Label>
              <Input
                type="time"
                value={draft.officialAmArrival || ""}
                onChange={(e) =>
                  setDraft({ ...draft, officialAmArrival: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Official AM Departure</Label>
              <Input
                type="time"
                value={draft.officialAmDeparture || ""}
                onChange={(e) =>
                  setDraft({ ...draft, officialAmDeparture: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Official PM Arrival</Label>
              <Input
                type="time"
                value={draft.officialPmArrival || ""}
                onChange={(e) =>
                  setDraft({ ...draft, officialPmArrival: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Official PM Departure</Label>
              <Input
                type="time"
                value={draft.officialPmDeparture || ""}
                onChange={(e) =>
                  setDraft({ ...draft, officialPmDeparture: e.target.value })
                }
              />
            </div>
          </div>
          <Button onClick={submit} className="w-full">Add employee</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employees ({store.state.employees.length})</CardTitle>
          <CardDescription>
            Verified by (printed under each DTR): set once for all sheets.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Verified by</Label>
            <Input
              value={store.state.verifiedBy}
              onChange={(e) => store.setVerifiedBy(e.target.value)}
              placeholder="HARRY D. CASTARDO"
            />
          </div>

          <div className="border rounded-md divide-y">
            {store.state.employees.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">
                No employees yet.
              </div>
            )}
            {store.state.employees.map((e) => (
              <div
                key={e.empNo}
                className="p-3 flex items-center justify-between text-sm gap-2"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    #{e.empNo} — {e.name}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {e.officialAmArrival || "—"} / {e.officialAmDeparture || "—"}
                    {" · "}
                    {e.officialPmArrival || "—"} / {e.officialPmDeparture || "—"}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <EditEmployeeButton employee={e} />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => store.removeEmployee(e.empNo)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>

      <BatchEmployeesPanel />
    </div>
  );
}

function EditEmployeeButton({ employee }: { employee: Employee }) {
  const store = useDtrStore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Employee>(employee);

  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) setDraft(employee);
  };

  const save = async () => {
    if (!draft.empNo.trim() || !draft.name.trim()) {
      toast.error("Employee No. and Name are required");
      return;
    }
    try {
      await store.saveEmployee(employee.empNo, {
        ...draft,
        empNo: draft.empNo.trim(),
        name: draft.name.trim(),
      });
      toast.success("Employee updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button variant="ghost" size="icon" onClick={() => onOpenChange(true)}>
        <Pencil className="h-4 w-4" />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit employee</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Employee No.</Label>
            <Input
              value={draft.empNo}
              onChange={(e) => setDraft({ ...draft, empNo: e.target.value })}
            />
          </div>
          <div>
            <Label>Name</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Official AM Arrival</Label>
              <Input
                type="time"
                value={draft.officialAmArrival || ""}
                onChange={(e) =>
                  setDraft({ ...draft, officialAmArrival: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Official AM Departure</Label>
              <Input
                type="time"
                value={draft.officialAmDeparture || ""}
                onChange={(e) =>
                  setDraft({ ...draft, officialAmDeparture: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Official PM Arrival</Label>
              <Input
                type="time"
                value={draft.officialPmArrival || ""}
                onChange={(e) =>
                  setDraft({ ...draft, officialPmArrival: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Official PM Departure</Label>
              <Input
                type="time"
                value={draft.officialPmDeparture || ""}
                onChange={(e) =>
                  setDraft({ ...draft, officialPmDeparture: e.target.value })
                }
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



function LogsPanel() {
  const store = useDtrStore();
  const [text, setText] = useState("");

  const knownEmpNos = useMemo(
    () => new Set(store.state.employees.map((e) => e.empNo)),
    [store.state.employees]
  );

  const summary = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of store.state.logs) m[l.empNo] = (m[l.empNo] || 0) + 1;
    return m;
  }, [store.state.logs]);

  const importLogs = async (mode: "append" | "replace") => {
    const parsed = parseRawLogs(text);
    if (parsed.length === 0) {
      toast.error("No valid log lines detected");
      return;
    }
    const unknown = parsed.filter((l) => !knownEmpNos.has(l.empNo));
    const dates = parsed.map((l) => l.date).sort();
    const range = dates.length ? ` · ${dates[0]} → ${dates[dates.length - 1]}` : "";
    const tail = unknown.length ? ` · ${unknown.length} reference unknown employees` : "";
    try {
      if (mode === "replace") await store.clearLogs();
      const res = await store.addLogs(parsed);
      if (res.error) {
        toast.error(`Saved ${res.inserted}/${parsed.length}. Error: ${res.error}`);
      } else {
        const skip = res.skipped ? ` · ${res.skipped} duplicate${res.skipped === 1 ? "" : "s"} skipped` : "";
        toast.success(`Imported ${res.inserted} log${res.inserted === 1 ? "" : "s"}${range}${skip}${tail}`);
      }
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to import logs");
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Paste raw logs</CardTitle>
          <CardDescription>
            Format per line: <code>EmpNo M/D/YYYY H:MM</code>. Header line
            "EmployeeNumber DateTime" is ignored. Multiple triplets on one line
            are also accepted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={14}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`EmployeeNumber DateTime\n1 11/3/2025 9:56\n1 11/3/2025 17:44\n2 11/3/2025 5:49\n2 11/3/2025 12:37`}
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button className="flex-1 sm:flex-none min-w-[110px]" onClick={() => importLogs("append")}>Append</Button>
            <Button className="flex-1 sm:flex-none min-w-[110px]" variant="outline" onClick={() => importLogs("replace")}>
              Replace all
            </Button>
            <Button
              className="flex-1 sm:flex-none min-w-[140px]"
              variant="secondary"
              onClick={() => {
                // Combine into normalized "EmpNo Date Time" per line.
                // Handles: (a) tab/space separated rows, (b) bare EmpNo on
                // one line + "Date Time" on the next, (c) one giant line
                // like "1 1/5/2026 9:00 1 1/7/2026 10:06 ...".
                const DATE = /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$|^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}$/;
                const TIME = /^\d{1,2}:\d{2}(?::\d{2})?$/;
                const AMPM = /^[AaPp][Mm.]*$/;
                const toks = text.split(/[\s,;|]+/).filter(Boolean);
                const out: string[] = [];
                let i = 0;
                while (i < toks.length) {
                  const emp = toks[i], date = toks[i + 1], time = toks[i + 2];
                  if (emp && /^\d+$/.test(emp) && date && DATE.test(date) && time && TIME.test(time)) {
                    let extra = "";
                    if (toks[i + 3] && AMPM.test(toks[i + 3])) { extra = " " + toks[i + 3]; i += 1; }
                    out.push(`${emp} ${date} ${time}${extra}`);
                    i += 3;
                  } else {
                    i += 1;
                  }
                }
                setText(out.join("\n"));
                toast.success(`Combined ${out.length} entries — ready to append`);
              }}
            >
              Combine columns
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              variant="ghost"
              onClick={() => {
                store.clearLogs();
                toast.success("Logs cleared");
              }}
            >
              Clear stored logs
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stored logs ({store.state.logs.length})</CardTitle>
          <CardDescription>Counts per employee number</CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(summary).length === 0 ? (
            <div className="text-sm text-muted-foreground">No logs yet.</div>
          ) : (
            <ul className="text-sm space-y-1">
              {Object.entries(summary).map(([emp, n]) => {
                const e = store.state.employees.find((x) => x.empNo === emp);
                return (
                  <li key={emp}>
                    <span className="font-medium">#{emp}</span>{" "}
                    {e ? `— ${e.name}` : <em className="text-muted-foreground">(unknown)</em>}{" "}
                    <span className="text-muted-foreground">· {n} entries</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DtrPanel({
  year,
  monthIndex0,
  selectedEmp,
  setYear,
  setMonthIndex0,
  setSelectedEmp,
}: {
  year: number;
  monthIndex0: number;
  selectedEmp: string;
  setYear: (y: number) => void;
  setMonthIndex0: (m: number) => void;
  setSelectedEmp: (e: string) => void;
}) {
  const store = useDtrStore();
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const l of store.state.logs) {
      const y = parseInt(l.date.slice(0, 4), 10);
      if (!isNaN(y)) set.add(y);
    }
    set.add(new Date().getFullYear());
    set.add(year);
    return Array.from(set).sort();
  }, [store.state.logs, year]);

  const emp = store.state.employees.find((e) => e.empNo === selectedEmp);

  const records = useMemo<DayRecord[]>(() => {
    if (!emp) return [];
    return buildMonthRecords(
      emp.empNo,
      year,
      monthIndex0,
      store.state.logs,
      store.state.overrides
    );
  }, [emp, year, monthIndex0, store.state.logs, store.state.overrides]);

  // Year+month combos that actually have logs for the selected employee
  const empMonths = useMemo(() => {
    if (!emp) return [] as { y: number; m: number; count: number }[];
    const counts: Record<string, number> = {};
    for (const l of store.state.logs) {
      if (l.empNo !== emp.empNo) continue;
      const [y, m] = l.date.split("-");
      const k = `${y}-${m}`;
      counts[k] = (counts[k] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([k, count]) => {
        const [y, m] = k.split("-").map((x) => parseInt(x, 10));
        return { y, m: m - 1, count };
      })
      .sort((a, b) => a.y - b.y || a.m - b.m);
  }, [emp, store.state.logs]);

  const currentMonthCount =
    empMonths.find((x) => x.y === year && x.m === monthIndex0)?.count ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate DTR</CardTitle>
        <CardDescription>
          Choose year, month, and employee. Edit any cell, then print — 3 DTRs
          per A4 landscape page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label>Year</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Month</Label>
            <Select
              value={String(monthIndex0)}
              onValueChange={(v) => setMonthIndex0(parseInt(v, 10))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={m} value={String(i)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Employee</Label>
            <Select value={selectedEmp} onValueChange={setSelectedEmp}>
              <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>
                {store.state.employees.map((e) => (
                  <SelectItem key={e.empNo} value={e.empNo}>
                    #{e.empNo} — {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {emp && (
          <div className="text-xs text-muted-foreground">
            {empMonths.length === 0 ? (
              <span className="text-destructive">
                No raw logs found for #{emp.empNo}. Paste logs in the "Raw Logs" tab first.
              </span>
            ) : (
              <>
                Logs available for{" "}
                {empMonths.map((x, i) => {
                  const active = x.y === year && x.m === monthIndex0;
                  return (
                    <button
                      key={`${x.y}-${x.m}`}
                      type="button"
                      onClick={() => {
                        setYear(x.y);
                        setMonthIndex0(x.m);
                      }}
                      className={
                        "underline mr-2 " +
                        (active ? "font-bold text-foreground" : "hover:text-foreground")
                      }
                    >
                      {MONTHS[x.m].slice(0, 3)} {x.y} ({x.count})
                    </button>
                  );
                })}
                {currentMonthCount === 0 && (
                  <span className="text-destructive">
                    · Current selection ({MONTHS[monthIndex0]} {year}) has 0 logs.
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {emp && (
          <div className="flex flex-wrap gap-2">
            <Button className="w-full sm:w-auto" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" />
              <span className="sm:inline">Print (3 per page, landscape A4)</span>
            </Button>
            <Button
              className="w-full sm:w-auto"
              variant="secondary"
              onClick={async () => {
                const node = document.getElementById("dtr-pdf-source");
                if (!node) {
                  toast.error("Preview not ready");
                  return;
                }
                try {
                  toast.info("Generating PDF…");
                  const canvas = await html2canvas(node, {
                    scale: 2,
                    backgroundColor: "#ffffff",
                    useCORS: true,
                    windowWidth: node.scrollWidth,
                  });
                  const pdf = new jsPDF({
                    orientation: "landscape",
                    unit: "mm",
                    format: "a4",
                  });
                  const imgData = canvas.toDataURL("image/png");
                  // Fit canvas into A4 landscape (297 x 210)
                  pdf.addImage(imgData, "PNG", 0, 0, 297, 210);
                  pdf.save(
                    `DTR_${emp.empNo}_${MONTHS[monthIndex0]}_${year}.pdf`
                  );
                  toast.success("PDF downloaded");
                } catch (err) {
                  console.error(err);
                  toast.error("Failed to generate PDF");
                }
              }}
            >
              <FileDown className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
            <Button
              className="w-full sm:w-auto"
              variant="outline"
              onClick={() => {
                store.clearOverrides(emp.empNo);
                toast.success("Manual edits cleared for this employee");
              }}
            >
              Reset edits for this employee
            </Button>
          </div>
        )}

        {emp ? (
          <div className="border rounded-md p-2 sm:p-4 overflow-auto bg-white print:hidden dtr-preview-wrap">
            <div className="dtr-preview-scale">
            <div id="dtr-pdf-source" className="dtr-page" style={{ width: "297mm" }}>
              <DtrSheet
                employee={emp}
                year={year}
                monthIndex0={monthIndex0}
                records={records}
                verifiedBy={store.state.verifiedBy}
                editable
                onEdit={(date, field, value) =>
                  store.setOverride(emp.empNo, date, field, value)
                }
              />
              <DtrSheet
                employee={emp}
                year={year}
                monthIndex0={monthIndex0}
                records={records}
                verifiedBy={store.state.verifiedBy}
              />
              <DtrSheet
                employee={emp}
                year={year}
                monthIndex0={monthIndex0}
                records={records}
                verifiedBy={store.state.verifiedBy}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Preview shows the print layout (3 copies per page, with dashed
              cut-lines). The first copy is editable — click any time cell to
              change it. Use <strong>Download PDF</strong> for a layout that
              matches this preview exactly.
            </p>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Select an employee to preview and print their DTR.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Renders the printable page outside the tab-switching area so window.print()
// always captures the currently selected employee's DTR.
function PrintArea({
  year,
  monthIndex0,
  selectedEmp,
}: {
  year: number;
  monthIndex0: number;
  selectedEmp: string;
}) {
  const store = useDtrStore();
  const emp = store.state.employees.find((e) => e.empNo === selectedEmp);
  if (!emp) return null;
  const records = buildMonthRecords(
    emp.empNo,
    year,
    monthIndex0,
    store.state.logs,
    store.state.overrides
  );
  return (
    <div className="hidden print:block">
      <div className="dtr-page">
        <DtrSheet employee={emp} year={year} monthIndex0={monthIndex0} records={records} verifiedBy={store.state.verifiedBy} />
        <DtrSheet employee={emp} year={year} monthIndex0={monthIndex0} records={records} verifiedBy={store.state.verifiedBy} />
        <DtrSheet employee={emp} year={year} monthIndex0={monthIndex0} records={records} verifiedBy={store.state.verifiedBy} />
      </div>
    </div>
  );
}
