#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <QuartzCore/QuartzCore.h>
#import <pthread.h>
#import <stdbool.h>
#import <stdint.h>
#import <stdio.h>
#import <stdlib.h>
#import <string.h>

@class AscilineNativeCameraHandle;

@interface AscilineNativeCameraDelegate : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate>
@property(nonatomic, weak) AscilineNativeCameraHandle *owner;
@end

@interface AscilineNativeCameraHandle : NSObject
@property(nonatomic, strong) AVCaptureSession *session;
@property(nonatomic, strong) AVCaptureVideoDataOutput *output;
@property(nonatomic, strong) AscilineNativeCameraDelegate *delegate;
@property(nonatomic, strong) dispatch_queue_t queue;
- (void)storeSampleBuffer:(CMSampleBufferRef)sampleBuffer;
- (bool)copyLatestTo:(uint8_t *)dst
           capacity:(size_t)capacity
              width:(uint32_t *)width
             height:(uint32_t *)height
           sequence:(uint64_t *)sequence
              ageMs:(double *)ageMs;
- (bool)latestWidth:(uint32_t *)width
             height:(uint32_t *)height
           sequence:(uint64_t *)sequence
              ageMs:(double *)ageMs;
- (void)stop;
@end

@implementation AscilineNativeCameraDelegate
- (void)captureOutput:(AVCaptureOutput *)output
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
           fromConnection:(AVCaptureConnection *)connection {
    (void)output;
    (void)connection;
    [self.owner storeSampleBuffer:sampleBuffer];
}
@end

@implementation AscilineNativeCameraHandle {
    pthread_mutex_t _mutex;
    uint8_t *_latestRgb;
    size_t _latestCapacity;
    size_t _latestLength;
    uint32_t _latestWidth;
    uint32_t _latestHeight;
    uint64_t _latestSequence;
    double _latestTimestamp;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        pthread_mutex_init(&_mutex, NULL);
    }
    return self;
}

- (void)dealloc {
    [self stop];
    if (_latestRgb != NULL) {
        free(_latestRgb);
        _latestRgb = NULL;
    }
    pthread_mutex_destroy(&_mutex);
}

- (void)stop {
    if (self.output != nil) {
        [self.output setSampleBufferDelegate:nil queue:nil];
    }
    if (self.session != nil) {
        [self.session stopRunning];
    }
    self.output = nil;
    self.delegate = nil;
    self.queue = nil;
    self.session = nil;
}

- (void)storeSampleBuffer:(CMSampleBufferRef)sampleBuffer {
    CVImageBufferRef imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (imageBuffer == NULL) {
        return;
    }

    CVReturn lockResult = CVPixelBufferLockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
    if (lockResult != kCVReturnSuccess) {
        return;
    }

    OSType pixelFormat = CVPixelBufferGetPixelFormatType(imageBuffer);
    if (pixelFormat != kCVPixelFormatType_32BGRA) {
        CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
        return;
    }

    uint8_t *base = (uint8_t *)CVPixelBufferGetBaseAddress(imageBuffer);
    size_t width = CVPixelBufferGetWidth(imageBuffer);
    size_t height = CVPixelBufferGetHeight(imageBuffer);
    size_t bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer);
    if (base == NULL || width == 0 || height == 0 || width > SIZE_MAX / height / 3) {
        CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
        return;
    }

    size_t rgbLength = width * height * 3;
    pthread_mutex_lock(&_mutex);
    if (_latestCapacity < rgbLength) {
        uint8_t *next = (uint8_t *)realloc(_latestRgb, rgbLength);
        if (next == NULL) {
            pthread_mutex_unlock(&_mutex);
            CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
            return;
        }
        _latestRgb = next;
        _latestCapacity = rgbLength;
    }

    for (size_t y = 0; y < height; y++) {
        const uint8_t *src = base + y * bytesPerRow;
        uint8_t *dst = _latestRgb + y * width * 3;
        for (size_t x = 0; x < width; x++) {
            dst[x * 3 + 0] = src[x * 4 + 2];
            dst[x * 3 + 1] = src[x * 4 + 1];
            dst[x * 3 + 2] = src[x * 4 + 0];
        }
    }

    _latestLength = rgbLength;
    _latestWidth = (uint32_t)width;
    _latestHeight = (uint32_t)height;
    _latestSequence += 1;
    _latestTimestamp = CACurrentMediaTime();
    pthread_mutex_unlock(&_mutex);

    CVPixelBufferUnlockBaseAddress(imageBuffer, kCVPixelBufferLock_ReadOnly);
}

- (bool)copyLatestTo:(uint8_t *)dst
           capacity:(size_t)capacity
              width:(uint32_t *)width
             height:(uint32_t *)height
           sequence:(uint64_t *)sequence
              ageMs:(double *)ageMs {
    if (dst == NULL) {
        return false;
    }

    pthread_mutex_lock(&_mutex);
    bool ok = _latestSequence > 0 && _latestRgb != NULL && capacity >= _latestLength;
    if (ok) {
        memcpy(dst, _latestRgb, _latestLength);
    }
    if (width != NULL) {
        *width = _latestWidth;
    }
    if (height != NULL) {
        *height = _latestHeight;
    }
    if (sequence != NULL) {
        *sequence = _latestSequence;
    }
    if (ageMs != NULL) {
        *ageMs = _latestTimestamp > 0.0 ? (CACurrentMediaTime() - _latestTimestamp) * 1000.0 : 0.0;
    }
    pthread_mutex_unlock(&_mutex);
    return ok;
}

- (bool)latestWidth:(uint32_t *)width
             height:(uint32_t *)height
           sequence:(uint64_t *)sequence
              ageMs:(double *)ageMs {
    pthread_mutex_lock(&_mutex);
    bool ok = _latestSequence > 0;
    if (width != NULL) {
        *width = _latestWidth;
    }
    if (height != NULL) {
        *height = _latestHeight;
    }
    if (sequence != NULL) {
        *sequence = _latestSequence;
    }
    if (ageMs != NULL) {
        *ageMs = _latestTimestamp > 0.0 ? (CACurrentMediaTime() - _latestTimestamp) * 1000.0 : 0.0;
    }
    pthread_mutex_unlock(&_mutex);
    return ok;
}
@end

static void asciline_set_error(char *error, size_t error_len, NSString *message) {
    if (error == NULL || error_len == 0) {
        return;
    }
    const char *utf8 = message.UTF8String;
    if (utf8 == NULL) {
        utf8 = "unknown native camera error";
    }
    snprintf(error, error_len, "%s", utf8);
}

static NSString *asciline_string_from_label(const char *device_label) {
    if (device_label == NULL || device_label[0] == '\0') {
        return nil;
    }
    return [NSString stringWithUTF8String:device_label];
}

static AVCaptureDevice *asciline_find_camera_device(const char *device_label) {
    NSArray<AVCaptureDevice *> *devices = [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo];
    NSString *needle = asciline_string_from_label(device_label);
    if (needle.length > 0) {
        for (AVCaptureDevice *device in devices) {
            if ([device.localizedName isEqualToString:needle] || [device.uniqueID isEqualToString:needle]) {
                return device;
            }
        }
        for (AVCaptureDevice *device in devices) {
            if ([device.localizedName rangeOfString:needle options:NSCaseInsensitiveSearch].location != NSNotFound ||
                [needle rangeOfString:device.localizedName options:NSCaseInsensitiveSearch].location != NSNotFound) {
                return device;
            }
        }
    }

    AVCaptureDevice *defaultDevice = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
    if (defaultDevice != nil) {
        return defaultDevice;
    }
    return devices.firstObject;
}

static NSString *asciline_session_preset(uint32_t width, uint32_t height) {
    uint32_t maxDimension = width > height ? width : height;
    if (maxDimension >= 1920) {
        if (@available(macOS 10.15, *)) {
            return AVCaptureSessionPreset1920x1080;
        }
        return AVCaptureSessionPresetHigh;
    }
    if (maxDimension >= 1280) {
        return AVCaptureSessionPreset1280x720;
    }
    return AVCaptureSessionPreset640x480;
}

static void asciline_apply_frame_rate(AVCaptureDevice *device, double fps) {
    if (device == nil || fps <= 0.0) {
        return;
    }
    NSError *error = nil;
    if (![device lockForConfiguration:&error]) {
        return;
    }
    int32_t scale = 1000;
    CMTime frameDuration = CMTimeMake(scale, (int32_t)(fps * (double)scale));
    device.activeVideoMinFrameDuration = frameDuration;
    device.activeVideoMaxFrameDuration = frameDuration;
    [device unlockForConfiguration];
}

void *asciline_native_camera_start(const char *device_label,
                                   uint32_t capture_width,
                                   uint32_t capture_height,
                                   double capture_fps,
                                   char *error,
                                   size_t error_len) {
    @autoreleasepool {
        if (@available(macOS 10.14, *)) {
            AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
            if (status != AVAuthorizationStatusAuthorized) {
                asciline_set_error(error, error_len, @"Native camera capture is not authorized");
                return NULL;
            }
        }

        AVCaptureDevice *device = asciline_find_camera_device(device_label);
        if (device == nil) {
            asciline_set_error(error, error_len, @"No native camera device is available");
            return NULL;
        }

        NSError *inputError = nil;
        AVCaptureDeviceInput *input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&inputError];
        if (input == nil) {
            asciline_set_error(error, error_len, inputError.localizedDescription ?: @"Could not create native camera input");
            return NULL;
        }

        AscilineNativeCameraHandle *handle = [[AscilineNativeCameraHandle alloc] init];
        AVCaptureSession *session = [[AVCaptureSession alloc] init];
        AVCaptureVideoDataOutput *output = [[AVCaptureVideoDataOutput alloc] init];
        AscilineNativeCameraDelegate *delegate = [[AscilineNativeCameraDelegate alloc] init];
        dispatch_queue_t queue = dispatch_queue_create("com.asciline.remix.native-camera", DISPATCH_QUEUE_SERIAL);

        [session beginConfiguration];
        NSString *preset = asciline_session_preset(capture_width, capture_height);
        if ([session canSetSessionPreset:preset]) {
            session.sessionPreset = preset;
        }
        if (![session canAddInput:input]) {
            [session commitConfiguration];
            asciline_set_error(error, error_len, @"Native camera session rejected camera input");
            return NULL;
        }
        [session addInput:input];

        output.alwaysDiscardsLateVideoFrames = YES;
        output.videoSettings = @{
            (NSString *)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA)
        };
        delegate.owner = handle;
        [output setSampleBufferDelegate:delegate queue:queue];
        if (![session canAddOutput:output]) {
            [session commitConfiguration];
            asciline_set_error(error, error_len, @"Native camera session rejected video output");
            return NULL;
        }
        [session addOutput:output];

        AVCaptureConnection *connection = [output connectionWithMediaType:AVMediaTypeVideo];
        if (connection.supportsVideoMirroring) {
            connection.videoMirrored = NO;
        }

        [session commitConfiguration];
        asciline_apply_frame_rate(device, capture_fps);

        handle.session = session;
        handle.output = output;
        handle.delegate = delegate;
        handle.queue = queue;

        [session startRunning];
        if (!session.isRunning) {
            asciline_set_error(error, error_len, @"Native camera session did not start");
            [handle stop];
            return NULL;
        }

        return (__bridge_retained void *)handle;
    }
}

bool asciline_native_camera_latest_metadata(void *handle,
                                            uint32_t *width,
                                            uint32_t *height,
                                            uint64_t *sequence,
                                            double *age_ms) {
    if (handle == NULL) {
        return false;
    }
    AscilineNativeCameraHandle *camera = (__bridge AscilineNativeCameraHandle *)handle;
    return [camera latestWidth:width height:height sequence:sequence ageMs:age_ms];
}

bool asciline_native_camera_copy_latest(void *handle,
                                        uint8_t *dst,
                                        size_t dst_len,
                                        uint32_t *width,
                                        uint32_t *height,
                                        uint64_t *sequence,
                                        double *age_ms) {
    if (handle == NULL) {
        return false;
    }
    AscilineNativeCameraHandle *camera = (__bridge AscilineNativeCameraHandle *)handle;
    return [camera copyLatestTo:dst capacity:dst_len width:width height:height sequence:sequence ageMs:age_ms];
}

void asciline_native_camera_stop(void *handle) {
    if (handle == NULL) {
        return;
    }
    AscilineNativeCameraHandle *camera = (__bridge_transfer AscilineNativeCameraHandle *)handle;
    [camera stop];
}
