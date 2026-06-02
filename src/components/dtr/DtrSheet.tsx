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

type Props = {
  employee: Employee;
  year: number;
  monthIndex0: number;
  records: DayRecord[];
  verifiedBy?: string;
  editable?: boolean;
  onEdit?: (date: string, field: keyof DayRecord, value: string) => void;
};

// One DTR card matching the Civil Service Form No. 48 layout.
export function DtrSheet({
  employee,
  year,
  monthIndex0,
  records,
  verifiedBy,
  editable,
  onEdit,
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
            return (
              <tr key={day}>
                <td className="dtr-day-col">{day}</td>
                <Cell value={showAmArr ? rec.amArrival : ""} editable={editable && showAmArr} onChange={(v) => onEdit?.(dk, "amArrival", v)} />
                <Cell value={showAmDep ? rec.amDeparture : ""} editable={editable && showAmDep} onChange={(v) => onEdit?.(dk, "amDeparture", v)} />
                <Cell value={showPmArr ? rec.pmArrival : ""} editable={editable && showPmArr} onChange={(v) => onEdit?.(dk, "pmArrival", v)} />
                <Cell value={showPmDep ? rec.pmDeparture : ""} editable={editable && showPmDep} onChange={(v) => onEdit?.(dk, "pmDeparture", v)} />
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
    </div>
  );
}

function Cell({
  value,
  editable,
  onChange,
}: {
  value: string;
  editable?: boolean;
  onChange: (v: string) => void;
}) {
  if (editable) {
    return (
      <td className="dtr-cell">
        <input
          type="time"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="dtr-cell-input"
        />
      </td>
    );
  }
  return <td className="dtr-cell">{value ? fmt12(value) : ""}</td>;
}
