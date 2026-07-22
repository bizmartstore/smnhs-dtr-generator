import { useEffect, useState } from "react";
import type { Employee, DayRecord } from "@/lib/dtr";
import {
  MONTHS,
  computeUndertime,
  daysInMonth,
  dateKey,
  fmt12,
  formatOfficialHours,
  getShiftType,
  maskRecordForShift,
} from "@/lib/dtr";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type EditField = keyof DayRecord;

type Props = {
  employee: Employee;
  year: number;
  monthIndex0: number;
  records: DayRecord[];
  verifiedBy?: string;
  editable?: boolean;
  /** Called when user saves the edit modal. Receives old + new value. */
  onEditTime?: (
    date: string,
    field: EditField,
    oldValue: string,
    newValue: string,
  ) => Promise<void> | void;
};

const FIELD_LABEL: Record<EditField, string> = {
  amArrival: "AM Arrival",
  amDeparture: "AM Departure",
  pmArrival: "PM Arrival",
  pmDeparture: "PM Departure",
};

export function DtrSheet({
  employee,
  year,
  monthIndex0,
  records,
  verifiedBy,
  editable,
  onEditTime,
}: Props) {
  const total = daysInMonth(year, monthIndex0);
  const official = formatOfficialHours(employee);
  const shift = getShiftType(employee);
  const showAmArr =
    shift === "am" || shift === "hybrid" || shift === "full" ||
    (shift === "custom" && !!employee.officialAmArrival);
  const showAmDep =
    shift === "am" || shift === "full" ||
    (shift === "custom" && !!employee.officialAmDeparture);
  const showPmArr =
    shift === "pm" || shift === "full" ||
    (shift === "custom" && !!employee.officialPmArrival);
  const showPmDep =
    shift === "pm" || shift === "hybrid" || shift === "full" ||
    (shift === "custom" && !!employee.officialPmDeparture);

  const [editTarget, setEditTarget] = useState<{
    date: string;
    field: EditField;
    oldValue: string;
    day: number;
  } | null>(null);

  let totalH = 0;
  let totalM = 0;

  return (
    <div className="dtr-sheet">
      <div className="dtr-top">
        <div className="dtr-form-no">Civil Service Form No. 48</div>
        <div className="dtr-title">DAILY TIME RECORD</div>
        <div className="dtr-divider">---o0o---</div>
        <div className="dtr-name">{employee.name || "\u00A0"}</div>
        <div className="dtr-name-label">(Name)</div>
        <div className="dtr-month-row">
          <span className="dtr-italic dtr-month-label">For the Month of</span>
          <span className="dtr-month-value">
            {MONTHS[monthIndex0].toUpperCase()} {year}
          </span>
        </div>
        <div className="dtr-official">
          <div className="dtr-official-left">
            <div className="dtr-italic">Official hours for arrival and</div>
            <div className="dtr-italic">departure</div>
          </div>
          <div className="dtr-official-right">
            <div className="dtr-official-line">
              <span className="dtr-italic">Regular days</span>
              <span className="dtr-official-time">{official || "\u00A0"}</span>
            </div>
            <div className="dtr-official-line">
              <span className="dtr-italic">Saturdays</span>
              <span className="dtr-italic">As office requires</span>
            </div>
          </div>
        </div>
      </div>

      <table className="dtr-table">
        <thead>
          <tr>
            <th rowSpan={2} className="dtr-day-col">Day</th>
            <th colSpan={2}>AM</th>
            <th colSpan={2}>PM</th>
            <th colSpan={2}>Undertime</th>
          </tr>
          <tr>
            <th>Arrival</th>
            <th>Departure</th>
            <th>Arrival</th>
            <th>Departure</th>
            <th>Hours</th>
            <th>Minutes</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: total }).map((_, i) => {
            const day = i + 1;
            const rec = maskRecordForShift(records[i], employee);
            const ut = computeUndertime(rec, employee);
            totalH += ut.h;
            totalM += ut.m;
            const dk = dateKey(year, monthIndex0, day);
            const utLabel = `${ut.h}:${String(ut.m).padStart(2, "0")}`;
            const openEdit = (field: EditField, oldValue: string) => {
              setEditTarget({ date: dk, field, oldValue, day });
            };
            return (
              <tr key={day}>
                <td className="dtr-day-col">{day}</td>
                <Cell value={showAmArr ? rec.amArrival : ""} editable={editable && showAmArr} onClick={() => openEdit("amArrival", rec.amArrival)} />
                <Cell value={showAmDep ? rec.amDeparture : ""} editable={editable && showAmDep} onClick={() => openEdit("amDeparture", rec.amDeparture)} />
                <Cell value={showPmArr ? rec.pmArrival : ""} editable={editable && showPmArr} onClick={() => openEdit("pmArrival", rec.pmArrival)} />
                <Cell value={showPmDep ? rec.pmDeparture : ""} editable={editable && showPmDep} onClick={() => openEdit("pmDeparture", rec.pmDeparture)} />
                <td className="dtr-ut" colSpan={2}>{utLabel}</td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={5} className="dtr-total-label">Total</td>
            <td className="dtr-ut" colSpan={2}>{`${totalH + Math.floor(totalM / 60)}:${String(totalM % 60).padStart(2, "0")}`}</td>
          </tr>
        </tbody>
      </table>

      <div className="dtr-cert">
        I certify on my honor that the above is a true and correct report of the hours of
        work performed, record of which was made daily at the time of arrival and
        departure from office.
      </div>

      <div className="dtr-sig">
        <div className="dtr-sig-name">{employee.name || "\u00A0"}</div>
      </div>

      <div className="dtr-verified">
        <span className="dtr-italic">VERIFIED as to the prescribed office hours:</span>
      </div>
      <div className="dtr-sig">
        <div className="dtr-sig-name">{verifiedBy || "\u00A0"}</div>
      </div>

      <div className="dtr-instructions">(See instructions on back)</div>

      {editable && (
        <EditTimeDialog
          target={editTarget}
          monthLabel={MONTHS[monthIndex0]}
          year={year}
          onClose={() => setEditTarget(null)}
          onSave={async (newValue) => {
            if (!editTarget) return;
            await onEditTime?.(
              editTarget.date,
              editTarget.field,
              editTarget.oldValue,
              newValue,
            );
            setEditTarget(null);
          }}
        />
      )}
    </div>
  );
}

function Cell({
  value,
  editable,
  onClick,
}: {
  value: string;
  editable?: boolean;
  onClick: () => void;
}) {
  if (editable) {
    return (
      <td className="dtr-cell">
        <button
          type="button"
          onClick={onClick}
          className="dtr-cell-btn"
          title="Click to edit"
        >
          {value ? fmt12(value) : <span className="dtr-cell-placeholder">—</span>}
        </button>
      </td>
    );
  }
  return <td className="dtr-cell">{value ? fmt12(value) : ""}</td>;
}

function EditTimeDialog({
  target,
  monthLabel,
  year,
  onClose,
  onSave,
}: {
  target: { date: string; field: EditField; oldValue: string; day: number } | null;
  monthLabel: string;
  year: number;
  onClose: () => void;
  onSave: (newValue: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(target?.oldValue ?? "");
  }, [target]);

  const open = target !== null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit time entry</DialogTitle>
          <DialogDescription>
            {target
              ? `${FIELD_LABEL[target.field]} — ${monthLabel} ${target.day}, ${year}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Current</Label>
            <div className="text-sm text-muted-foreground">
              {target?.oldValue ? fmt12(target.oldValue) : "— (empty)"}
            </div>
          </div>
          <div>
            <Label htmlFor="dtr-edit-time">New time</Label>
            <Input
              id="dtr-edit-time"
              type="time"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty and save to clear this entry.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {target?.oldValue ? (
            <Button
              variant="ghost"
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave("");
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
            >
              Clear
            </Button>
          ) : null}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
