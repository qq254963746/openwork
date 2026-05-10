use std::path::Path;
use std::process::Command;

pub fn command_for_program(program: &Path) -> Command {
    Command::new(program)
}
