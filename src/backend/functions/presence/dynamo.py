"""DynamoDB helpers used by the processor, presence and event Lambdas. No AWS calls here."""
from decimal import Decimal

# Alert rows (alerts table) expire after a week.
ALERT_TTL_SECONDS = 7 * 24 * 3600


def to_dynamo(value):
    """float -> Decimal(str(x)), recursively (boto3 rejects float)."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_dynamo(v) for v in value]
    return value


def is_condition_failed(ex):
    """True for the ConditionalCheckFailedException of a conditional write."""
    return getattr(ex, "response", {}).get("Error", {}).get("Code") == "ConditionalCheckFailedException"
