"""PostFreely - API: public config."""
import db_access


def get_public_config(req):
    return {"data": db_access.public_config()}
