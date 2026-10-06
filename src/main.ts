/**
 * One entry point. The shell decides which view to render from `?view=`.
 */

import './ui/base.css';
import './views/employer/employer.css';
import './views/employee/employee.css';
import { startShell } from './views/shell/index.js';
import { renderEmployer } from './views/employer/index.js';
import { renderEmployee } from './views/employee/index.js';

startShell({
  render: (view, container) =>
    view === 'employer' ? renderEmployer(container) : renderEmployee(container),
});
