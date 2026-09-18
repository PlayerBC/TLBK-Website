import copy
import unittest
from datetime import datetime

from bson import ObjectId
from pymongo.errors import ServerSelectionTimeoutError

from app import MAX_DOCUMENTS, QUERY_TIMEOUT_MS, create_app


class FakeCursor:
    def __init__(self, documents):
        self.documents = documents
        self.timeout = None
        self.maximum = None

    def max_time_ms(self, timeout):
        self.timeout = timeout
        return self

    def limit(self, maximum):
        self.maximum = maximum
        return self

    def __iter__(self):
        return iter(self.documents[:self.maximum])


class FakeCollection:
    def __init__(self, db, name):
        self.db = db
        self.name = name

    def find_one(self, query, projection, **options):
        self.db.calls.append(("find_one", self.name, query, projection, options))
        self.db.check_failure()
        return self.db.document

    def find(self, query, projection):
        self.db.calls.append(("find", self.name, query, projection))
        self.db.check_failure()
        self.db.cursor = FakeCursor(self.db.documents)
        return self.db.cursor

    def aggregate(self, pipeline, **options):
        self.db.calls.append(("aggregate", self.name, pipeline, options))
        self.db.check_failure()
        return self.db.documents


class FakeDatabase:
    def __init__(self):
        self.calls = []
        self.document = None
        self.documents = []
        self.failure = None
        self.cursor = None

    def check_failure(self):
        if self.failure:
            raise self.failure

    def __getitem__(self, name):
        return FakeCollection(self, name)

    def command(self, command):
        self.calls.append(("command", command))
        self.check_failure()
        return {"ok": 1}


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.client_options = []

        def factory(uri, **options):
            self.client_options.append((uri, options))
            return {"tlb_kitchen_website": self.db}

        self.app = create_app({"TESTING": True, "MONGODB_URI": "mongodb://unit-test.invalid"}, factory)
        self.client = self.app.test_client()

    def post(self, route, collection, **fields):
        return self.client.post("/api/" + route, json={"collection": collection, **fields})

    @staticmethod
    def search_payload(collection, query="cake"):
        index, path = ("default", "keywords") if collection == "custom-orders" else ("search", "title")
        return [{"$search": {"index": index, "autocomplete": {"query": query, "path": path}}}]

    def test_catalog_categories_contract_and_private_fields_excluded(self):
        for collection in ("pastries", "custom-orders"):
            with self.subTest(collection=collection):
                self.db.document = {"categories": ["Cookies", "Cakes"], "secret": "never return", "_id": ObjectId()}
                result = self.post("findOne", collection, filter={"spec_id": "categories"})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json, {"document": {"categories": ["Cookies", "Cakes"]}})
                self.assertEqual(self.db.calls[-1][2:], ({"spec_id": "categories"}, {"_id": 0, "categories": 1}, {"max_time_ms": QUERY_TIMEOUT_MS}))

    def test_catalog_items_contract_and_database_limits(self):
        for collection in ("pastries", "custom-orders"):
            self.db.documents = [{"title": "Cake", "picture": "https://example.com/cake.jpg", "cost": 100, "private_note": "hidden"}]
            result = self.post("find", collection, filter={"category": "Cakes", "type": "item"})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json, {"documents": [{"title": "Cake", "picture": "https://example.com/cake.jpg"}]})
            self.assertEqual(self.db.calls[-1][2], {"category": "Cakes", "type": "item"})
            self.assertEqual(self.db.cursor.timeout, QUERY_TIMEOUT_MS)
            self.assertEqual(self.db.cursor.maximum, MAX_DOCUMENTS + 1)

    def test_blog_listing_excludes_article_content_and_private_data(self):
        self.db.documents = [{"id": "first", "title": "First post", "image": "https://example.com/blog.jpg", "description": "Summary", "time": "18 September 2026", "content": "Long article", "author_email": "private@example.com"}]
        response = self.post("find", "blogs", filter={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json["documents"][0]), {"id", "title", "image", "description", "time"})

    def test_blog_article_contract_and_missing_article(self):
        self.db.document = {"id": "first", "title": "First post", "content": "<p>Article</p>", "private_note": "hidden"}
        response = self.post("findOne", "blogs", filter={"id": "first"})
        self.assertEqual(response.json, {"document": {"id": "first", "title": "First post", "content": "<p>Article</p>"}})
        self.db.document = None
        self.assertEqual(self.post("findOne", "blogs", filter={"id": "missing"}).json, {"document": None})

    def test_objectid_and_date_are_json_compatible(self):
        identity = ObjectId()
        self.db.documents = [{"id": identity, "title": "Post", "time": datetime(2026, 9, 18)}]
        doc = self.post("find", "blogs", filter={}).json["documents"][0]
        self.assertEqual(doc["id"], str(identity))
        self.assertEqual(doc["time"], "2026-09-18T00:00:00")

    def test_nested_values_cannot_expose_private_subdocuments(self):
        self.db.document = {"categories": ["Cakes", {"private": "secret"}]}
        self.assertEqual(self.post("findOne", "pastries", filter={"spec_id": "categories"}).json, {"document": {"categories": ["Cakes"]}})
        self.db.documents = [{"title": {"private": "secret"}, "picture": "https://example.com/public.jpg"}]
        self.assertNotIn("title", self.post("find", "pastries", filter={"category": "Cakes", "type": "item"}).json["documents"][0])

    def test_supported_searches_rebuild_limited_projected_pipeline(self):
        for collection, limit in (("custom-orders", 24), ("blogs", 10)):
            with self.subTest(collection=collection):
                pipeline = self.search_payload(collection)
                original = copy.deepcopy(pipeline)
                result = self.post("aggregate", collection, pipeline=pipeline)
                self.assertEqual(result.status_code, 200)
                call = self.db.calls[-1]
                self.assertEqual(call[:2], ("aggregate", collection))
                self.assertEqual(call[2][0], original[0])
                self.assertEqual(call[2][-2], {"$limit": limit})
                self.assertEqual(call[2][-1]["$project"]["_id"], 0)
                self.assertEqual(call[3], {"maxTimeMS": QUERY_TIMEOUT_MS})
                if collection == "custom-orders":
                    self.assertIn({"$match": {"type": "item"}}, call[2])
                self.assertEqual(pipeline, original)

    def test_invalid_collections_and_arbitrary_filters_never_reach_database(self):
        cases = [
            ("find", "users", {}), ("find", "orders", {}), ("find", "admin.system.users", {}),
            ("find", "blogs", {"password": {"$exists": True}}),
            ("find", "pastries", {}), ("find", "pastries", {"category": {"$ne": None}, "type": "item"}),
            ("find", "custom-orders", {"category": "Cake", "type": {"$ne": "item"}}),
            ("find", "pastries", {"category": "Cake", "type": "item", "$where": "evil"}),
            ("findOne", "pastries", {"spec_id": {"$ne": None}}),
            ("findOne", "blogs", {"id": {"$regex": ".*"}}),
            ("findOne", "blogs", {"id": "a", "private": True}),
            ("findOne", "blogs", {"id": ""}), ("findOne", "blogs", {"id": "a" * 201}),
            ("findOne", "blogs", {"id": "bad\x00value"}),
        ]
        for route, collection, query in cases:
            with self.subTest(route=route, collection=collection, query=query):
                self.assertEqual(self.post(route, collection, filter=query).status_code, 400)
        self.assertEqual(self.db.calls, [])
        self.assertEqual(self.client_options, [])

    def test_write_join_and_modified_search_pipelines_are_rejected(self):
        pipelines = [[], {}, [{"$out": "stolen"}], [{"$merge": "orders"}], [{"$lookup": {"from": "users"}}],
                     [{"$match": {}}], [{"$search": {"index": "wrong", "autocomplete": {"query": "cake", "path": "keywords"}}}]]
        valid = self.search_payload("custom-orders")
        pipelines.extend([valid + [{"$out": "stolen"}], valid + [{"$limit": 90000}]])
        for field, value in (("path", "private_note"), ("query", {"$gt": ""}), ("query", "x" * 101), ("query", " ")):
            altered = copy.deepcopy(valid)
            altered[0]["$search"]["autocomplete"][field] = value
            pipelines.append(altered)
        altered = copy.deepcopy(valid)
        altered[0]["$search"]["autocomplete"]["fuzzy"] = {}
        pipelines.append(altered)
        for pipeline in pipelines:
            with self.subTest(pipeline=pipeline):
                self.assertEqual(self.post("aggregate", "custom-orders", pipeline=pipeline).status_code, 400)
        self.assertEqual(self.post("aggregate", "pastries", pipeline=valid).status_code, 400)
        self.assertEqual(self.db.calls, [])

    def test_malformed_json_extra_fields_and_body_limit(self):
        for value in (None, [], "string", 1, {"collection": []}, {"collection": "blogs", "filter": {}, "projection": {"password": 1}}):
            with self.subTest(value=value):
                self.assertEqual(self.client.post("/api/find", json=value).status_code, 400)
        self.assertEqual(self.client.post("/api/find", data="{bad", content_type="application/json").status_code, 400)
        self.assertEqual(self.client.post("/api/find", data="x" * 9000, content_type="application/json").status_code, 413)
        self.assertEqual(self.db.calls, [])

    def test_unknown_endpoints_and_write_methods(self):
        for path in ("/api/insertOne", "/api/deleteMany", "/api/updateOne", "/api/categories"):
            self.assertEqual(self.client.post(path, json={}).status_code, 404)
        self.assertEqual(self.client.get("/api/find").status_code, 405)
        self.assertEqual(self.client.delete("/api/find").status_code, 405)
        self.assertEqual(self.db.calls, [])

    def test_database_failures_are_sanitized_in_response_and_logs(self):
        self.db.failure = ServerSelectionTimeoutError("mongodb://user:secret-password@private-host")
        with self.assertLogs(self.app.logger, level="WARNING") as logs:
            response = self.post("find", "blogs", filter={})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret-password", response.text + "".join(logs.output))
        self.assertNotIn("private-host", response.text + "".join(logs.output))

    def test_unexpected_errors_are_sanitized(self):
        self.db.failure = ValueError("private configuration")
        with self.assertLogs(self.app.logger, level="ERROR") as logs:
            response = self.client.get("/health")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private configuration", response.text + "".join(logs.output))

    def test_health_reads_ping_but_root_does_not_connect(self):
        self.assertEqual(self.client.get("/").json["read_only"], True)
        self.assertEqual(self.client_options, [])
        self.assertEqual(self.client.get("/health").json, {"status": "healthy", "database": "connected"})
        self.assertEqual(self.db.calls, [("command", "ping")])
        self.client.get("/health")
        self.assertEqual(len(self.client_options), 1)
        self.assertEqual(self.client_options[0][1]["serverSelectionTimeoutMS"], 5000)
        self.assertFalse(self.client_options[0][1]["connect"])

    def test_missing_configuration_does_not_claim_health(self):
        app = create_app({"TESTING": True, "MONGODB_URI": ""})
        with self.assertLogs(app.logger, level="WARNING"):
            self.assertEqual(app.test_client().get("/health").status_code, 503)
        self.assertEqual(app.test_client().get("/").status_code, 200)

    def test_cors_allows_only_known_origins_and_does_not_enable_credentials(self):
        for origin in ("https://thelittlebakerkitchen.com", "https://www.thelittlebakerkitchen.com"):
            response = self.client.get("/", headers={"Origin": origin})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
            self.assertNotIn("Access-Control-Allow-Credentials", response.headers)
            self.assertIn("Origin", response.headers["Vary"])
        for origin in ("https://evil.example", "https://thelittlebakerkitchen.com.evil.example", "null"):
            response = self.client.post("/api/find", json={"collection": "blogs", "filter": {}}, headers={"Origin": origin})
            self.assertEqual(response.status_code, 403)
            self.assertNotIn("Access-Control-Allow-Origin", response.headers)
        self.assertEqual(self.db.calls, [])

    def test_preflight_matches_site_json_posts_without_database_access(self):
        headers = {"Origin": "https://thelittlebakerkitchen.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type"}
        response = self.client.options("/api/find", headers=headers)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.headers["Access-Control-Allow-Methods"], "POST")
        self.assertEqual(response.headers["Access-Control-Allow-Headers"], "Content-Type")
        self.assertEqual(self.client.options("/api/missing", headers=headers).status_code, 404)
        self.assertEqual(self.client.options("/api/find", headers={**headers, "Access-Control-Request-Method": "DELETE"}).status_code, 403)
        self.assertEqual(self.client.options("/api/find", headers={**headers, "Access-Control-Request-Headers": "Authorization"}).status_code, 403)
        self.assertEqual(self.client_options, [])

    def test_cors_headers_also_apply_to_errors(self):
        response = self.client.post("/api/find", json={}, headers={"Origin": "https://thelittlebakerkitchen.com"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://thelittlebakerkitchen.com")

    def test_overlarge_catalog_is_not_silently_truncated(self):
        self.db.documents = [{}] * (MAX_DOCUMENTS + 1)
        with self.assertLogs(self.app.logger, level="WARNING"):
            response = self.post("find", "blogs", filter={})
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
