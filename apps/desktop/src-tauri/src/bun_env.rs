const SAFE_DNS_RESULT_ORDER: &str = "verbatim";

fn is_valid_dns_result_order(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized == "ipv4first" || normalized == "verbatim"
}

fn sanitize_dns_result_order_args(raw: &str) -> Option<String> {
    let tokens: Vec<&str> = raw.split_whitespace().collect();
    let mut kept = Vec::new();
    let mut changed = false;
    let mut index = 0usize;

    while index < tokens.len() {
        let token = tokens[index];

        if let Some(order) = token.strip_prefix("--dns-result-order=") {
            if is_valid_dns_result_order(order) {
                kept.push(token.to_string());
            } else {
                changed = true;
            }
            index += 1;
            continue;
        }

        if token == "--dns-result-order" {
            match tokens.get(index + 1).copied() {
                Some(order) if is_valid_dns_result_order(order) => {
                    kept.push(token.to_string());
                    kept.push(order.to_string());
                }
                Some(_) | None => {
                    changed = true;
                }
            }
            index += 2;
            continue;
        }

        kept.push(token.to_string());
        index += 1;
    }

    if !changed {
        return None;
    }

    Some(kept.join(" "))
}

pub fn bun_env_overrides() -> Vec<(&'static str, String)> {
    let mut overrides = vec![(
        "BUN_CONFIG_DNS_RESULT_ORDER",
        SAFE_DNS_RESULT_ORDER.to_string(),
    )];

    if let Ok(value) = std::env::var("BUN_OPTIONS") {
        if let Some(sanitized) = sanitize_dns_result_order_args(&value) {
            overrides.push(("BUN_OPTIONS", sanitized));
        }
    }

    if let Ok(value) = std::env::var("NODE_OPTIONS") {
        if let Some(sanitized) = sanitize_dns_result_order_args(&value) {
            overrides.push(("NODE_OPTIONS", sanitized));
        }
    }

    overrides
}
