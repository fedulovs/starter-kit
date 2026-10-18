package platform;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.MissingNode;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** Thin HTTP client used to talk to the game backends. */
public final class GameClient {

    /** Games are expected to answer well inside this. */
    public static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(2);

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();

    public record Response(int status, JsonNode body) {
    }

    public Response get(String url) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(REQUEST_TIMEOUT)
                .header("Accept", "application/json")
                .GET()
                .build();
        return send(request);
    }

    public Response post(String url, Object body) throws IOException, InterruptedException {
        byte[] payload = Http.MAPPER.writeValueAsBytes(body);
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(REQUEST_TIMEOUT)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .build();
        return send(request);
    }

    private Response send(HttpRequest request) throws IOException, InterruptedException {
        HttpResponse<byte[]> response = http.send(request, HttpResponse.BodyHandlers.ofByteArray());
        JsonNode body;
        try {
            body = response.body().length == 0
                    ? MissingNode.getInstance()
                    : Http.MAPPER.readTree(response.body());
        } catch (IOException notJson) {
            body = MissingNode.getInstance();
        }
        return new Response(response.statusCode(), body);
    }
}
