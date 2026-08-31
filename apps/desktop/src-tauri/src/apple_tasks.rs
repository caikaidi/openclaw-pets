use serde::Deserialize;
use std::process::Command;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppleDateParts {
    year: i32,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarTodoInput {
    title: String,
    notes: String,
    start: AppleDateParts,
    end: AppleDateParts,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderTodoInput {
    title: String,
    notes: String,
    due: Option<AppleDateParts>,
}

const CALENDAR_SCRIPT: &str = r#"
on configuredDate(yearValue, monthValue, dayValue, hourValue, minuteValue)
  set resultDate to current date
  set day of resultDate to 1
  set year of resultDate to yearValue
  set month of resultDate to monthValue
  set day of resultDate to dayValue
  set hours of resultDate to hourValue
  set minutes of resultDate to minuteValue
  set seconds of resultDate to 0
  return resultDate
end configuredDate

on run argv
  set eventTitle to item 1 of argv
  set eventNotes to item 2 of argv
  set startDate to configuredDate((item 3 of argv) as integer, (item 4 of argv) as integer, (item 5 of argv) as integer, (item 6 of argv) as integer, (item 7 of argv) as integer)
  set endDate to configuredDate((item 8 of argv) as integer, (item 9 of argv) as integer, (item 10 of argv) as integer, (item 11 of argv) as integer, (item 12 of argv) as integer)
  tell application "Calendar"
    set writableCalendars to every calendar whose writable is true
    if (count of writableCalendars) is 0 then error "No writable Apple Calendar is available"
    tell item 1 of writableCalendars
      make new event at end of events with properties {summary:eventTitle, description:eventNotes, start date:startDate, end date:endDate}
    end tell
  end tell
end run
"#;

const REMINDERS_SCRIPT: &str = r#"
on configuredDate(yearValue, monthValue, dayValue, hourValue, minuteValue)
  set resultDate to current date
  set day of resultDate to 1
  set year of resultDate to yearValue
  set month of resultDate to monthValue
  set day of resultDate to dayValue
  set hours of resultDate to hourValue
  set minutes of resultDate to minuteValue
  set seconds of resultDate to 0
  return resultDate
end configuredDate

on run argv
  set reminderTitle to item 1 of argv
  set reminderNotes to item 2 of argv
  set hasDueDate to item 3 of argv
  tell application "Reminders"
    set targetList to default list
    if hasDueDate is "1" then
      set dueDate to my configuredDate((item 4 of argv) as integer, (item 5 of argv) as integer, (item 6 of argv) as integer, (item 7 of argv) as integer, (item 8 of argv) as integer)
      tell targetList to make new reminder at end of reminders with properties {name:reminderTitle, body:reminderNotes, due date:dueDate}
    else
      tell targetList to make new reminder at end of reminders with properties {name:reminderTitle, body:reminderNotes}
    end if
  end tell
end run
"#;

fn leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn valid_date(value: &AppleDateParts) -> bool {
    let days = match value.month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap_year(value.year) => 29,
        2 => 28,
        _ => return false,
    };
    (1970..=9999).contains(&value.year)
        && value.day >= 1
        && value.day <= days
        && value.hour <= 23
        && value.minute <= 59
}

fn validate_text(title: &str, notes: &str) -> Result<(), String> {
    if title.trim().is_empty()
        || title.len() > 160
        || title.chars().any(char::is_control)
        || notes.len() > 4_000
        || notes.chars().any(|character| character == '\0')
    {
        return Err("Apple task text is invalid".into());
    }
    Ok(())
}

fn date_args(value: &AppleDateParts) -> [String; 5] {
    [
        value.year.to_string(),
        value.month.to_string(),
        value.day.to_string(),
        value.hour.to_string(),
        value.minute.to_string(),
    ]
}

fn run_osascript(script: &str, arguments: &[String], app_name: &str) -> Result<(), String> {
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .arg("--")
        .args(arguments)
        .output()
        .map_err(|_| format!("Could not open Apple {app_name}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(automation_error(&output.stderr, app_name))
    }
}

fn automation_error(stderr: &[u8], app_name: &str) -> String {
    let diagnostic = String::from_utf8_lossy(stderr);
    if diagnostic.contains("(-1743)") || diagnostic.contains("not authorized") {
        return format!(
            "Could not add this todo to Apple {app_name}. Allow OpenClaw Pets in System Settings > Privacy & Security > Automation."
        );
    }
    format!("Apple {app_name} rejected this todo. Please try again.")
}

pub fn add_to_calendar(input: CalendarTodoInput) -> Result<(), String> {
    validate_text(&input.title, &input.notes)?;
    if !valid_date(&input.start) || !valid_date(&input.end) {
        return Err("Apple Calendar dates are invalid".into());
    }
    let start = date_args(&input.start);
    let end = date_args(&input.end);
    if (
        input.end.year,
        input.end.month,
        input.end.day,
        input.end.hour,
        input.end.minute,
    ) <= (
        input.start.year,
        input.start.month,
        input.start.day,
        input.start.hour,
        input.start.minute,
    ) {
        return Err("Apple Calendar end date must be after its start date".into());
    }
    let mut arguments = vec![input.title, input.notes];
    arguments.extend(start);
    arguments.extend(end);
    run_osascript(CALENDAR_SCRIPT, &arguments, "Calendar")
}

pub fn add_to_reminders(input: ReminderTodoInput) -> Result<(), String> {
    validate_text(&input.title, &input.notes)?;
    let mut arguments = vec![input.title, input.notes];
    if let Some(due) = input.due {
        if !valid_date(&due) {
            return Err("Apple Reminders due date is invalid".into());
        }
        arguments.push("1".into());
        arguments.extend(date_args(&due));
    } else {
        arguments.push("0".into());
    }
    run_osascript(REMINDERS_SCRIPT, &arguments, "Reminders")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_apple_automation_scripts_compile() {
        let directory = tempfile::tempdir().expect("temporary directory");
        for (index, script) in [CALENDAR_SCRIPT, REMINDERS_SCRIPT].iter().enumerate() {
            let output = directory.path().join(format!("automation-{index}.scpt"));
            let status = Command::new("/usr/bin/osacompile")
                .arg("-e")
                .arg(script)
                .arg("-o")
                .arg(output)
                .status()
                .expect("AppleScript compiler");
            assert!(status.success(), "Apple automation script must compile");
        }
        assert!(
            REMINDERS_SCRIPT.contains("set dueDate to my configuredDate("),
            "the Reminders tell block must call the local date handler explicitly"
        );
    }

    #[test]
    fn rejects_normalized_or_reversed_calendar_dates_before_automation() {
        assert!(!valid_date(&AppleDateParts {
            year: 2026,
            month: 2,
            day: 30,
            hour: 9,
            minute: 0,
        }));
        assert!(valid_date(&AppleDateParts {
            year: 2028,
            month: 2,
            day: 29,
            hour: 9,
            minute: 0,
        }));
    }

    #[test]
    fn reports_automation_guidance_only_for_a_permission_denial() {
        assert!(
            automation_error(b"execution error: Not authorized (-1743)", "Reminders")
                .contains("Privacy & Security > Automation")
        );
        assert_eq!(
            automation_error(b"configuredDate cannot continue (-1708)", "Reminders"),
            "Apple Reminders rejected this todo. Please try again."
        );
    }
}
