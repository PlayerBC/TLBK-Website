"""Public, read-only content API for the existing TLB Kitchen brochure pages.

The endpoint names preserve the browser contract, but are not a MongoDB proxy.
Only the queries explicitly constructed below can reach the database. Use an
Atlas user with read access to this content database only as a second boundary.
"""

import os
from datetime import date, datetime
from threading import Lock

from bson import ObjectId
from flask import Flask, jsonify, request
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from werkzeug.exceptions import HTTPException


CATALOGS = frozenset({"pastries", "custom-orders"})
COLLECTIONS = CATALOGS | {"blogs"}
ITEM_FIELDS = ("title", "picture")
BLOG_FIELDS = ("id", "title", "image", "description", "time")
CATEGORY_FIELDS = ("categories",)
ARTICLE_FIELDS = ("id", "title", "content")
MAX_DOCUMENTS = 5000
QUERY_TIMEOUT_MS = 5000
DEFAULT_ORIGINS = (
    "https://thelittlebakerkitchen.com,https://www.thelittlebakerkitchen.com"
)


class InvalidRequest(Exception):
    """The caller requested something outside the public content contract."""


class ContentUnavailable(Exception):
    """Database configuration or public content is unavailable."""


def exact_keys(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def text_value(value, maximum):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise InvalidRequest()
    if any(ord(character) < 32 for character in value):
        raise InvalidRequest()
    return value


def public_document(document, fields):
    """Apply the projection again at the response boundary; omit nested values."""
    if document is None:
        return None
    result = {}
    for field in fields:
        value = document.get(field)
        if field == "categories":
            if isinstance(value, list):
                result[field] = [item for item in value if isinstance(item, str)]
        elif isinstance(value, (str, int, float, bool)) or value is None:
            result[field] = value
        elif isinstance(value, ObjectId):
            result[field] = str(value)
        elif isinstance(value, (datetime, date)):
            result[field] = value.isoformat()
    return result


def projection(fields):
    return {"_id": 0, **{field: 1 for field in fields}}


def create_app(config=None, client_factory=MongoClient):
    app = Flask(__name__)
    app.config.from_mapping(
        MONGODB_URI=os.environ.get("MONGODB_URI", ""),
        DATABASE_NAME=os.environ.get("DATABASE_NAME", "tlb_kitchen_website"),
        ALLOWED_ORIGINS=os.environ.get("ALLOWED_ORIGINS", DEFAULT_ORIGINS),
        MAX_CONTENT_LENGTH=8192,
    )
    if config:
        app.config.update(config)
    origins = frozenset(
        origin.strip()
        for origin in app.config["ALLOWED_ORIGINS"].split(",")
        if origin.strip()
    )
    client = None
    client_lock = Lock()

    def database():
        nonlocal client
        if not app.config["MONGODB_URI"] or not app.config["DATABASE_NAME"]:
            raise ContentUnavailable()
        # Initialize inside the worker, without import-time network access.
        with client_lock:
            if client is None:
                client = client_factory(
                    app.config["MONGODB_URI"],
                    connect=False,
                    serverSelectionTimeoutMS=5000,
                    connectTimeoutMS=5000,
                    socketTimeoutMS=10000,
                    maxPoolSize=20,
                    appname="tlb-kitchen-content",
                )
        return client[app.config["DATABASE_NAME"]]

    def payload(key):
        value = request.get_json(silent=True)
        if not exact_keys(value, {"collection", key}):
            raise InvalidRequest()
        collection = value["collection"]
        if not isinstance(collection, str) or collection not in COLLECTIONS:
            raise InvalidRequest()
        return collection, value[key]

    @app.before_request
    def check_origin_and_preflight():
        origin = request.headers.get("Origin")
        if origin and origin not in origins:
            return jsonify(error="Origin is not allowed."), 403
        if request.method == "OPTIONS":
            # Only existing routes and the methods/headers actually used by the site.
            if request.url_rule is None:
                return jsonify(error="Endpoint not found."), 404
            method = request.headers.get("Access-Control-Request-Method", "")
            headers = {
                header.strip().lower()
                for header in request.headers.get("Access-Control-Request-Headers", "").split(",")
                if header.strip()
            }
            allowed_methods = {"GET", "HEAD"} if request.path in {"/", "/health"} else {"POST"}
            if method not in allowed_methods or not headers <= {"content-type"}:
                return jsonify(error="Preflight request is not allowed."), 403
            response = app.make_response(("", 204))
            response.headers["Access-Control-Allow-Methods"] = ", ".join(sorted(allowed_methods))
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Max-Age"] = "600"
            return response

    @app.after_request
    def response_headers(response):
        origin = request.headers.get("Origin")
        if origin in origins:
            response.headers["Access-Control-Allow-Origin"] = origin
        response.vary.add("Origin")
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.errorhandler(InvalidRequest)
    def invalid_request(_error):
        return jsonify(error="Unsupported public content request."), 400

    @app.errorhandler(ContentUnavailable)
    @app.errorhandler(PyMongoError)
    def database_error(error):
        # Driver exception messages can contain hostnames, URI options or secrets.
        app.logger.warning("Content request unavailable (%s)", type(error).__name__)
        return jsonify(error="Content is temporarily unavailable. Please try again shortly."), 503

    @app.errorhandler(HTTPException)
    def http_error(error):
        messages = {404: "Endpoint not found.", 405: "Method not allowed.", 413: "Request is too large."}
        return jsonify(error=messages.get(error.code, "Invalid request.")), error.code

    @app.errorhandler(Exception)
    def unexpected_error(error):
        app.logger.error("Content request failed (%s)", type(error).__name__)
        return jsonify(error="Content is temporarily unavailable. Please try again shortly."), 503

    @app.get("/")
    def root():
        return jsonify(service="TLB Kitchen public content API", status="running", read_only=True)

    @app.get("/health")
    def health():
        database().command("ping")
        return jsonify(status="healthy", database="connected")

    @app.post("/api/findOne")
    def find_one():
        collection, supplied_filter = payload("filter")
        if collection in CATALOGS and supplied_filter == {"spec_id": "categories"}:
            query = {"spec_id": "categories"}
            fields = CATEGORY_FIELDS
        elif collection == "blogs" and exact_keys(supplied_filter, {"id"}):
            query = {"id": text_value(supplied_filter["id"], 200)}
            fields = ARTICLE_FIELDS
        else:
            raise InvalidRequest()
        document = database()[collection].find_one(
            query, projection(fields), max_time_ms=QUERY_TIMEOUT_MS
        )
        return jsonify(document=public_document(document, fields))

    @app.post("/api/find")
    def find():
        collection, supplied_filter = payload("filter")
        if collection in CATALOGS and exact_keys(supplied_filter, {"category", "type"}):
            if supplied_filter["type"] != "item":
                raise InvalidRequest()
            query = {"category": text_value(supplied_filter["category"], 200), "type": "item"}
            fields = ITEM_FIELDS
        elif collection == "blogs" and supplied_filter == {}:
            query = {}
            fields = BLOG_FIELDS
        else:
            raise InvalidRequest()
        cursor = database()[collection].find(query, projection(fields))
        documents = list(cursor.max_time_ms(QUERY_TIMEOUT_MS).limit(MAX_DOCUMENTS + 1))
        if len(documents) > MAX_DOCUMENTS:
            # Do not silently truncate and produce incorrect browser pagination.
            raise ContentUnavailable()
        return jsonify(documents=[public_document(document, fields) for document in documents])

    @app.post("/api/aggregate")
    def search():
        collection, supplied_pipeline = payload("pipeline")
        allowed_searches = {"custom-orders": ("default", "keywords", ITEM_FIELDS, 24),
                            "blogs": ("search", "title", BLOG_FIELDS, 10)}
        if collection not in allowed_searches:
            raise InvalidRequest()
        if not isinstance(supplied_pipeline, list) or len(supplied_pipeline) != 1:
            raise InvalidRequest()
        stage = supplied_pipeline[0]
        if not exact_keys(stage, {"$search"}):
            raise InvalidRequest()
        supplied_search = stage["$search"]
        if not exact_keys(supplied_search, {"index", "autocomplete"}):
            raise InvalidRequest()
        autocomplete = supplied_search["autocomplete"]
        if not exact_keys(autocomplete, {"query", "path"}):
            raise InvalidRequest()
        index, path, fields, limit = allowed_searches[collection]
        if supplied_search["index"] != index or autocomplete["path"] != path:
            raise InvalidRequest()
        query = text_value(autocomplete["query"], 100)
        # Never pass the client's pipeline to MongoDB, even after validation.
        pipeline = [
            {"$search": {"index": index, "autocomplete": {"query": query, "path": path}}},
        ]
        if collection == "custom-orders":
            pipeline.append({"$match": {"type": "item"}})
        pipeline.extend([{"$limit": limit}, {"$project": projection(fields)}])
        documents = database()[collection].aggregate(pipeline, maxTimeMS=QUERY_TIMEOUT_MS)
        return jsonify(documents=[public_document(document, fields) for document in documents])

    return app


app = create_app()
