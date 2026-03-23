import type {
  AddSkillCommand,
  CheckSkillCommand,
  FindSkillCommand,
  InitSkillCommand,
  ListSkillCommand,
  RemoveSkillCommand,
  UpdateSkillCommand,
  ValidateSkillCommand,
} from "../contracts/commands";
import type {
  AddSkillResult,
  CheckSkillResult,
  FindSkillResult,
  InitSkillResult,
  ListSkillResult,
  RemoveSkillResult,
  UpdateSkillResult,
  ValidationReport,
} from "../contracts/results";
import type { CoreCommandPort } from "../interfaces/ports";

export class AddSkillService {
  constructor(private readonly port: CoreCommandPort) {}
  execute(command: AddSkillCommand): Promise<AddSkillResult> {
    return this.port.addSkill(command);
  }
}

export class UpdateSkillService {
  constructor(private readonly port: CoreCommandPort) {}
  execute(command: UpdateSkillCommand): Promise<UpdateSkillResult> {
    return this.port.updateSkill(command);
  }
}

export class CheckSkillService {
  constructor(private readonly port: CoreCommandPort) {}
  execute(command: CheckSkillCommand): Promise<CheckSkillResult> {
    return this.port.checkSkill(command);
  }
}

export class ValidateSkillService {
  constructor(private readonly port: CoreCommandPort) {}
  execute(command: ValidateSkillCommand): Promise<ValidationReport> {
    return this.port.validateSkill(command);
  }
}

export class ListSkillService {
  constructor(private readonly port: CoreCommandPort) {}
  execute(command: ListSkillCommand): Promise<ListSkillResult> {
    return this.port.listSkill(command);
  }
}

export class RemoveSkillService {
  constructor(private readonly port: CoreCommandPort) {}
  execute(command: RemoveSkillCommand): Promise<RemoveSkillResult> {
    return this.port.removeSkill(command);
  }
}

export class FindSkillService {
  constructor(private readonly port: CoreCommandPort) {}
  execute(command: FindSkillCommand): Promise<FindSkillResult> {
    return this.port.findSkill(command);
  }
}

export class InitSkillService {
  constructor(private readonly port: CoreCommandPort) {}
  execute(command: InitSkillCommand): Promise<InitSkillResult> {
    return this.port.initSkill(command);
  }
}
