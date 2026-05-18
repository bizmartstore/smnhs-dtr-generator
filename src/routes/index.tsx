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
import { Trash2, Printer } from "lucide-react";

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
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">DTR Generator</h1>
          <p className="text-sm text-muted-foreground">
            Civil Service Form No. 48 · Build DTRs from raw biometric logs · Print
            3 per A4 landscape page
          </p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        <Tabs defaultValue="employees" className="no-print">
          <TabsList>
            <TabsTrigger value="employees">Employees</TabsTrigger>
            <TabsTrigger value="logs">Raw Logs</TabsTrigger>
            <TabsTrigger value="dtr">Generate DTR</TabsTrigger>
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
                className="p-3 flex items-center justify-between text-sm"
              >
                <div>
                  <div className="font-medium">
                    #{e.empNo} — {e.name}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {e.officialAmArrival || "—"} / {e.officialAmDeparture || "—"}
                    {" · "}
                    {e.officialPmArrival || "—"} / {e.officialPmDeparture || "—"}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => store.removeEmployee(e.empNo)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
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

  const importLogs = (mode: "append" | "replace") => {
    const parsed = parseRawLogs(text);
    if (parsed.length === 0) {
      toast.error("No valid log lines detected");
      return;
    }
    const unknown = parsed.filter((l) => !knownEmpNos.has(l.empNo));
    if (mode === "replace") store.replaceLogs(parsed);
    else store.addLogs(parsed);
    toast.success(
      `Imported ${parsed.length} log${parsed.length === 1 ? "" : "s"}` +
        (unknown.length
          ? ` · ${unknown.length} reference unknown employees`
          : "")
    );
    setText("");
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
          <div className="flex gap-2">
            <Button onClick={() => importLogs("append")}>Append</Button>
            <Button variant="outline" onClick={() => importLogs("replace")}>
              Replace all
            </Button>
            <Button
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" />
              Print (3 per page, landscape A4)
            </Button>
            <Button
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
          <div className="border rounded-md p-4 overflow-auto bg-white print:hidden">
            <div className="dtr-page" style={{ width: "297mm" }}>
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
              Preview shows the print layout (3 copies per page). The first
              copy is editable — click any time cell to change it.
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
