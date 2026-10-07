import { CrudController } from '../../http/crud.js';
import {
  createDepartmentSchema,
  departmentFilterSchema,
  updateDepartmentSchema,
  type CreateDepartmentInput,
  type DepartmentFilter,
  type UpdateDepartmentInput,
} from './department.schemas.js';
import { type DepartmentService } from './department.service.js';

// Departments follow the standard list/get/create/update/delete shape.
export class DepartmentController extends CrudController<
  DepartmentFilter,
  CreateDepartmentInput,
  UpdateDepartmentInput
> {
  public constructor(departments: DepartmentService) {
    super(
      departments,
      { singular: 'department', plural: 'departments' },
      {
        filter: departmentFilterSchema,
        create: createDepartmentSchema,
        update: updateDepartmentSchema,
      },
    );
  }
}
