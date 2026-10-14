from datetime import date
from typing import List, Optional

from pydantic import BaseModel


class RecapRow(BaseModel):
    user_id: int
    employee_id: str
    name: str
    role: str
    site_name: Optional[str]
    workdays: int          # scheduled workdays up to today
    present: int           # days with a check-in (any day, incl. weekends)
    ontime: int
    late: int
    out_of_radius: int
    sick: int
    permit: int
    annual: int
    absent: int            # past workdays with no check-in and no approved leave
    absent_dates: List[date]
    work_minutes: int
    overtime_minutes: int
    needs_review: int      # check-ins still waiting in the review queue
