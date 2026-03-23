import {
  AddSkillService,
  CheckSkillService,
  FindSkillService,
  InitSkillService,
  ListSkillService,
  RemoveSkillService,
  UpdateSkillService,
  ValidateSkillService,
} from "@skillspp/core";
import { createNodeCoreCommandPort } from "./core-port";

export function createNodeCoreServices() {
  const port = createNodeCoreCommandPort();

  return {
    addSkill: new AddSkillService(port),
    updateSkill: new UpdateSkillService(port),
    checkSkill: new CheckSkillService(port),
    validateSkill: new ValidateSkillService(port),
    listSkill: new ListSkillService(port),
    removeSkill: new RemoveSkillService(port),
    findSkill: new FindSkillService(port),
    initSkill: new InitSkillService(port),
  };
}

export { createNodeCoreCommandPort };
export { runBackgroundTask } from "./background-runner";
