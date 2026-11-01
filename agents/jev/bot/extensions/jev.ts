// Jev decisions. choose_move calls `decide` directly; the mount also gives the
// model a read-only jev__evaluate tool. Auth: TYPESAFE_API_KEY (repo .env).
import jev from "@grok/agent-sdk/extensions/jev";

export default jev({ harnessTools: true, skills: false });
