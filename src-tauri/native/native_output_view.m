#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

@interface AscilineMetalOutputView : NSView
@property(nonatomic, strong) CAMetalLayer *metalLayer;
- (void)ascilineUpdateDrawableSize;
@end

@implementation AscilineMetalOutputView

- (instancetype)initWithFrame:(NSRect)frameRect {
    self = [super initWithFrame:frameRect];
    if (self) {
        self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        self.wantsLayer = YES;

        CAMetalLayer *layer = [CAMetalLayer layer];
        layer.opaque = YES;
        layer.framebufferOnly = YES;
        layer.needsDisplayOnBoundsChange = YES;
        layer.presentsWithTransaction = NO;
        if ([layer respondsToSelector:@selector(setAllowsNextDrawableTimeout:)]) {
            layer.allowsNextDrawableTimeout = NO;
        }
        if ([layer respondsToSelector:@selector(setDisplaySyncEnabled:)]) {
            layer.displaySyncEnabled = NO;
        }
        if (@available(macOS 10.13.2, *)) {
            layer.maximumDrawableCount = 3;
        }

        self.layer = layer;
        self.metalLayer = layer;
        [self ascilineUpdateDrawableSize];
    }
    return self;
}

- (BOOL)isOpaque {
    return YES;
}

- (void)setFrameSize:(NSSize)newSize {
    [super setFrameSize:newSize];
    [self ascilineUpdateDrawableSize];
}

- (void)setBoundsSize:(NSSize)newSize {
    [super setBoundsSize:newSize];
    [self ascilineUpdateDrawableSize];
}

- (void)viewDidMoveToWindow {
    [super viewDidMoveToWindow];
    [self ascilineUpdateDrawableSize];
}

- (void)viewDidChangeBackingProperties {
    [super viewDidChangeBackingProperties];
    [self ascilineUpdateDrawableSize];
}

- (void)ascilineUpdateDrawableSize {
    CAMetalLayer *layer = self.metalLayer;
    if (layer == nil) {
        return;
    }

    CGFloat scale = self.window.backingScaleFactor;
    if (scale <= 0.0) {
        scale = NSScreen.mainScreen.backingScaleFactor;
    }
    if (scale <= 0.0) {
        scale = 1.0;
    }

    NSRect bounds = self.bounds;
    CGSize drawableSize = CGSizeMake(MAX(1.0, ceil(bounds.size.width * scale)),
                                     MAX(1.0, ceil(bounds.size.height * scale)));
    layer.frame = bounds;
    layer.contentsScale = scale;
    layer.drawableSize = drawableSize;
}

@end

static void AscilineRunOnMainSync(dispatch_block_t block) {
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_sync(dispatch_get_main_queue(), block);
    }
}

void *asciline_native_output_install_metal_view(void *hostObjectPtr) {
    if (hostObjectPtr == NULL) {
        return NULL;
    }

    __block AscilineMetalOutputView *outputView = nil;
    AscilineRunOnMainSync(^{
        id hostObject = (__bridge id)hostObjectPtr;
        NSView *hostView = nil;
        if ([hostObject isKindOfClass:NSWindow.class]) {
            hostView = ((NSWindow *)hostObject).contentView;
        } else if ([hostObject isKindOfClass:NSView.class]) {
            hostView = (NSView *)hostObject;
        }
        if (hostView == nil) {
            return;
        }

        NSArray<NSView *> *subviews = [hostView.subviews copy];
        for (NSView *subview in subviews) {
            if ([subview isKindOfClass:AscilineMetalOutputView.class]) {
                [subview removeFromSuperview];
            }
        }

        outputView = [[AscilineMetalOutputView alloc] initWithFrame:hostView.bounds];
        [hostView addSubview:outputView positioned:NSWindowAbove relativeTo:nil];
        [outputView ascilineUpdateDrawableSize];
    });

    return (__bridge_retained void *)outputView;
}

void *asciline_native_output_metal_layer(void *outputViewPtr) {
    if (outputViewPtr == NULL) {
        return NULL;
    }

    __block void *layerPtr = NULL;
    AscilineRunOnMainSync(^{
        AscilineMetalOutputView *outputView = (__bridge AscilineMetalOutputView *)outputViewPtr;
        layerPtr = (__bridge void *)outputView.metalLayer;
    });
    return layerPtr;
}

void asciline_native_output_resize_metal_view(void *outputViewPtr) {
    if (outputViewPtr == NULL) {
        return;
    }

    AscilineRunOnMainSync(^{
        AscilineMetalOutputView *outputView = (__bridge AscilineMetalOutputView *)outputViewPtr;
        NSView *hostView = outputView.superview;
        if (hostView != nil) {
            outputView.frame = hostView.bounds;
        }
        [outputView ascilineUpdateDrawableSize];
    });
}

void asciline_native_output_release_metal_view(void *outputViewPtr) {
    if (outputViewPtr == NULL) {
        return;
    }

    AscilineMetalOutputView *outputView = (__bridge_transfer AscilineMetalOutputView *)outputViewPtr;
    if ([NSThread isMainThread]) {
        [outputView removeFromSuperview];
        return;
    }

    dispatch_async(dispatch_get_main_queue(), ^{
        [outputView removeFromSuperview];
    });
}
